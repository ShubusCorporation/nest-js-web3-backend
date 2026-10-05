import { Injectable } from '@nestjs/common';
import { ConnectError, Code } from '@connectrpc/connect';
import { create } from '@bufbuild/protobuf';
import { Redis } from 'ioredis';

import {
  GetTransactionsRequest,
  GetTransactionsResponseSchema,
  TransactionSchema,
  StreamTransactionsRequest,
  Transaction,
} from '@src/generated/proto/src/proto/wallet-service_pb';

import { WalletService as WalletServiceClass } from './wallet.service';

interface RedisTransaction {
  id: string;
  txHash: string;
  fromAddress: string;
  toAddress: string;
  amount: string;
  timestamp: string;
  tokenSymbol: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isRedisTransaction(value: unknown): value is RedisTransaction {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.id === 'string' &&
    typeof value.txHash === 'string' &&
    typeof value.fromAddress === 'string' &&
    typeof value.toAddress === 'string' &&
    typeof value.amount === 'string' &&
    typeof value.timestamp === 'string' &&
    typeof value.tokenSymbol === 'string'
  );
}

function getErrorStatus(error: unknown): number | undefined {
  if (!isRecord(error)) {
    return undefined;
  }

  return typeof error.status === 'number' ? error.status : undefined;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (isRecord(error) && typeof error.message === 'string') {
    return error.message;
  }

  return 'Неизвестная ошибка';
}

@Injectable()
export class WalletController {
  private readonly redisSubscriber: Redis;

  constructor(private readonly walletService: WalletServiceClass) {
    this.redisSubscriber = new Redis(
      process.env.REDIS_URL ?? 'redis://localhost:6379',
    );
  }

  /**
   * Unary RPC: получение транзакций с пагинацией.
   */
  async getTransactions(req: GetTransactionsRequest) {
    try {
      const result = await this.walletService.getUserTransactions(
        req.walletAddress,
        req.page,
        req.limit,
      );

      const protoTransactions = result.transactions.map((tx) =>
        create(TransactionSchema, {
          id: tx.id,
          txHash: tx.txHash,
          fromAddress: tx.fromAddress,
          toAddress: tx.toAddress,
          amount: tx.amount,
          timestamp: tx.timestamp.toISOString(),
          tokenSymbol: tx.tokenSymbol,
        }),
      );

      return create(GetTransactionsResponseSchema, {
        totalCount: result.totalCount,
        hasMore: result.hasMore,
        transactions: protoTransactions,
      });
    } catch (error: unknown) {
      console.error('[WalletController] getTransactions error:', error);
      const status = getErrorStatus(error);
      const message = getErrorMessage(error);

      if (status === 400) {
        throw new ConnectError(message, Code.InvalidArgument);
      }

      if (status === 404) {
        throw new ConnectError(message, Code.NotFound);
      }
      throw new ConnectError('Внутренняя ошибка сервера', Code.Internal);
    }
  }

  /**
   * Server Streaming RPC.
   * How to check:
   * docker exec -it nest-redis redis-cli PUBLISH NEW_TRANSACTION "{\"id\":\"live-1\",\"txHash\":\"0x9999999999999999999999999999999999999999999999999999999999999999\",\"fromAddress\":\"0x0000000000000000000000000000000000000000\",\"toAddress\":\"0x730BFc4f4D221a8D84787524973692C0801Fe681\",\"amount\":\"777\",\"timestamp\":\"2026-09-03T16:00:00.000Z\",\"tokenSymbol\":\"USDT\"}"
   */
  async *streamTransactions(
    req: StreamTransactionsRequest,
  ): AsyncIterable<Transaction> {
    const targetAddress = req.walletAddress.toLowerCase();

    if (!targetAddress.startsWith('0x')) {
      throw new ConnectError(
        'Неверный формат адреса для стриминга',
        Code.InvalidArgument,
      );
    }

    const channel = 'NEW_TRANSACTION';

    console.log(
      `📠 [gRPC Stream] Открыт поток транзакций для кошелька: ${targetAddress}`,
    );

    try {
      /**
       * Redis Pub/Sub.
       *
       * Важно:
       * subscribe() нельзя использовать вместе с BLPOP.
       * После subscribe Redis connection становится subscriber connection.
       */
      const transactionQueue: RedisTransaction[] = [];
      let resolveNext: (() => void) | undefined;

      const handleMessage = (
        receivedChannel: string,
        message: string,
      ): void => {
        if (receivedChannel !== channel) {
          return;
        }

        let parsed: unknown;

        try {
          parsed = JSON.parse(message) as unknown;
        } catch (error: unknown) {
          console.error(
            '[gRPC Stream] Не удалось распарсить Redis message:',
            error,
          );
          return;
        }

        if (!isRedisTransaction(parsed)) {
          console.error(
            '[gRPC Stream] Некорректный формат Redis transaction:',
            parsed,
          );
          return;
        }

        const isTargetTransaction =
          parsed.toAddress.toLowerCase() === targetAddress ||
          parsed.fromAddress.toLowerCase() === targetAddress;

        if (!isTargetTransaction) {
          return;
        }

        transactionQueue.push(parsed);

        resolveNext?.();
        resolveNext = undefined;
      };

      this.redisSubscriber.on('message', handleMessage);

      await this.redisSubscriber.subscribe(channel);

      try {
        while (true) {
          if (transactionQueue.length === 0) {
            await new Promise<void>((resolve) => {
              resolveNext = resolve;
            });
          }

          const txData = transactionQueue.shift();

          if (!txData) {
            continue;
          }

          yield create(TransactionSchema, {
            id: txData.id,
            txHash: txData.txHash,
            fromAddress: txData.fromAddress,
            toAddress: txData.toAddress,
            amount: txData.amount,
            timestamp: txData.timestamp,
            tokenSymbol: txData.tokenSymbol,
          });
        }
      } finally {
        this.redisSubscriber.off('message', handleMessage);

        await this.redisSubscriber.unsubscribe(channel);

        console.log(
          `🔌 [gRPC Stream] Клиент отключился, подписка Redis закрыта для ${targetAddress}`,
        );
      }
    } catch (error: unknown) {
      if (error instanceof ConnectError) {
        throw error;
      }

      console.error('[gRPC Stream] Ошибка внутри стрима:', error);

      throw new ConnectError(
        'Поток данных был аварийно прерван',
        Code.Internal,
      );
    }
  }
}
