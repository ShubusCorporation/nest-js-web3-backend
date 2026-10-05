/*
 * ============================================================================
 * Notification Gateway — Architecture Notes & Investigation Findings
 * ============================================================================
 *
 * PURPOSE
 * -------
 * This gateway is responsible for delivering real-time blockchain transaction
 * notifications to connected frontend clients through WebSockets.
 *
 * It consumes transaction events from Redis Pub/Sub, converts and validates
 * the received data, determines the appropriate wallet rooms, and broadcasts
 * the transaction to subscribed clients.
 *
 *
 * INVESTIGATION FINDINGS
 * ----------------------
 *
 * 1. Redis is the communication boundary
 * --------------------------------------
 * The gateway does not communicate with the blockchain directly.
 *
 * BlockchainListener is responsible for detecting blockchain events,
 * persisting relevant transactions, and publishing them to Redis.
 *
 * This gateway consumes those Redis events and handles only real-time client
 * notification delivery.
 *
 *
 * 2. Redis messages are external/untrusted input
 * ----------------------------------------------
 * Redis messages are received as JSON strings and therefore cannot be assumed
 * to have a valid transaction structure.
 *
 * JSON.parse() produces untrusted runtime data and is explicitly treated as
 * `unknown`.
 *
 * The payload is validated before any transaction properties are accessed.
 *
 *
 * 3. The protobuf Transaction is the application contract
 * --------------------------------------------------------
 * The generated protobuf Transaction schema is used as the canonical
 * transaction representation exposed by the application.
 *
 * The Redis payload is considered a transport representation only.
 *
 * After validation, the received data is converted into the generated
 * protobuf Transaction type before being sent to WebSocket clients.
 *
 * This prevents Redis-specific data structures from becoming part of the
 * frontend-facing application contract.
 *
 *
 * 4. No `any` is intentionally allowed at the data boundary
 * ----------------------------------------------------------
 * Strict TypeScript and type-aware ESLint rules are enabled throughout the
 * project.
 *
 * Redis JSON data is therefore handled through the following boundary:
 *
 *   Redis JSON
 *       |
 *       v
 *     unknown
 *       |
 *       v
 *   Runtime validation
 *       |
 *       v
 *   Typed transaction payload
 *       |
 *       v
 *   Protobuf Transaction
 *       |
 *       v
 *   WebSocket client
 *
 * Unsafe type assertions and `any` are intentionally avoided.
 *
 *
 * 5. Wallet addresses are used as WebSocket rooms
 * -----------------------------------------------
 * Each wallet address represents a Socket.IO room.
 *
 * Clients subscribe to a wallet-specific room and receive transaction
 * notifications only for transactions involving that wallet.
 *
 * Both the recipient and sender addresses are used as room identifiers so
 * that clients can receive notifications for incoming as well as outgoing
 * transactions.
 *
 *
 * 6. Room subscription is intentionally fire-and-forget
 * -----------------------------------------------------
 * Socket.IO's `join()` operation may return a Promise because the underlying
 * adapter can perform asynchronous operations.
 *
 * The gateway does not depend on the result of the room join operation before
 * continuing the handler.
 *
 * The Promise is therefore explicitly marked with `void` to indicate
 * intentional fire-and-forget execution and to satisfy the project's strict
 * `no-floating-promises` policy.
 *
 *
 * 7. Redis subscription is handled asynchronously
 * ------------------------------------------------
 * The initial Redis subscription must complete before the gateway starts
 * receiving transaction messages.
 *
 * Therefore the subscription operation is awaited and errors are handled
 * explicitly.
 *
 * Unlike Socket.IO room joining, Redis subscription initialization is a
 * required part of gateway startup and must not silently fail.
 *
 *
 * 8. WebSocket delivery is separated from blockchain processing
 * ---------------------------------------------------------------
 * This gateway does not:
 *
 *   - listen to Ethereum directly;
 *   - query the blockchain;
 *   - write transactions to the database;
 *   - decide whether a wallet is registered.
 *
 * Those responsibilities belong to the blockchain/domain layer.
 *
 * This gateway is intentionally limited to:
 *
 *   Redis event -> validation -> transaction conversion -> WebSocket delivery
 *
 *
 * DATA FLOW
 * ---------
 *
 *   Ethereum / USDT Contract
 *            |
 *            v
 *   BlockchainListener
 *            |
 *            v
 *      Prisma / Database
 *            |
 *            v
 *       Redis Pub/Sub
 *            |
 *            v
 *   NotificationGateway
 *            |
 *            +----> recipient wallet room
 *            |
 *            +----> sender wallet room
 *            |
 *            v
 *      Socket.IO Clients
 *
 *
 * ERROR HANDLING
 * --------------
 * Invalid JSON received from Redis is rejected without affecting the Redis
 * subscription or other connected clients.
 *
 * Redis subscription errors are caught during gateway initialization.
 *
 * Invalid transaction payloads are rejected before they can reach the
 * WebSocket layer.
 *
 *
 * CONCLUSION
 * ----------
 * The NotificationGateway acts as the real-time delivery boundary between
 * the backend event system and frontend clients.
 *
 * Redis provides decoupling from blockchain processing, while the generated
 * protobuf Transaction provides the canonical application-level transaction
 * contract.
 *
 * The gateway intentionally contains no blockchain or persistence logic.
 *
 * ============================================================================
 */
import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Redis } from 'ioredis';
import { Injectable } from '@nestjs/common';
import { create } from '@bufbuild/protobuf';

import {
  Transaction,
  TransactionSchema,
} from '@src/generated/proto/src/proto/wallet-service_pb';

interface RedisTransactionPayload {
  id: string;
  txHash: string;
  fromAddress: string;
  toAddress: string;
  amount: string;
  timestamp: string;
  tokenSymbol: string;
}

function isRedisTransactionPayload(
  value: unknown,
): value is RedisTransactionPayload {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const data = value as Record<string, unknown>;

  return (
    typeof data.id === 'string' &&
    typeof data.txHash === 'string' &&
    typeof data.fromAddress === 'string' &&
    typeof data.toAddress === 'string' &&
    typeof data.amount === 'string' &&
    typeof data.timestamp === 'string' &&
    typeof data.tokenSymbol === 'string'
  );
}

@WebSocketGateway(8081, {
  cors: {
    origin: '*',
  },
})
@Injectable()
export class NotificationGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server!: Server;

  private readonly redisSubscriber: Redis;

  constructor() {
    this.redisSubscriber = new Redis(
      process.env.REDIS_URL ?? 'redis://localhost:6379',
    );
  }

  afterInit(): void {
    console.log('⚡ [WebSockets] Сервер успешно инициализирован');

    void this.listenRedisUpdates();
  }

  handleConnection(client: Socket): void {
    console.log(`🔌 [WebSockets] Клиент подключился: ${client.id}`);
  }

  handleDisconnect(client: Socket): void {
    console.log(`❌ [WebSockets] Клиент отключился: ${client.id}`);
  }

  @SubscribeMessage('subscribe_wallet')
  handleWalletSubscribe(
    @MessageBody() data: { walletAddress: string },
    @ConnectedSocket() client: Socket,
  ): void {
    const room = data.walletAddress.toLowerCase();

    /*
     * Socket.IO's join() returns a Promise because joining a room may involve
     * asynchronous adapter operations.
     *
     * We intentionally do not await it here because this handler only needs to
     * initiate the room subscription and does not depend on the completion result.
     * The WebSocket connection remains active while Socket.IO performs the join.
     *
     * Using `void` explicitly marks this Promise as intentionally fire-and-forget
     * and satisfies the project's strict no-floating-promises policy.
     */
    if (!client.rooms.has(room)) {
      void client.join(room);
    }

    console.log(
      `👤 Клиент ${client.id} подписался на обновления кошелька: ${room}`,
    );

    client.emit('subscribed', {
      status: 'success',
      wallet: room,
    });
  }

  private async listenRedisUpdates(): Promise<void> {
    try {
      await this.redisSubscriber.subscribe('NEW_TRANSACTION');

      this.redisSubscriber.on(
        'message',
        (channel: string, message: string): void => {
          if (channel !== 'NEW_TRANSACTION') {
            return;
          }

          this.handleRedisMessage(message);
        },
      );
    } catch (error: unknown) {
      console.error('[WebSockets] Ошибка подписки на Redis:', error);
    }
  }

  private handleRedisMessage(message: string): void {
    let parsed: unknown;

    try {
      parsed = JSON.parse(message) as unknown;
    } catch (error: unknown) {
      console.error('[WebSockets] Не удалось распарсить Redis message:', error);
      return;
    }

    if (!isRedisTransactionPayload(parsed)) {
      console.error(
        '[WebSockets] Redis message содержит некорректную transaction:',
        parsed,
      );
      return;
    }

    const transaction: Transaction = create(TransactionSchema, {
      id: parsed.id,
      txHash: parsed.txHash,
      fromAddress: parsed.fromAddress,
      toAddress: parsed.toAddress,
      amount: parsed.amount,
      timestamp: parsed.timestamp,
      tokenSymbol: parsed.tokenSymbol,
    });

    const recipientRoom = transaction.toAddress.toLowerCase();
    const senderRoom = transaction.fromAddress.toLowerCase();

    this.server.to(recipientRoom).emit('notification_tx', transaction);
    this.server.to(senderRoom).emit('notification_tx', transaction);
    console.log(`📢 [WebSockets] Пуш отправлен в комнату: ${recipientRoom}`);
  }
}
