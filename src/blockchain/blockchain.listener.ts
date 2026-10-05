/*
 * ============================================================================
 * Blockchain Listener — Architecture Notes & Investigation Findings
 * ============================================================================
 *
 * PURPOSE
 * -------
 * This service listens for USDT Transfer events on the Ethereum mainnet,
 * persists relevant transactions to the database, and publishes them through
 * Redis Pub/Sub for real-time notification delivery.
 *
 *
 * INVESTIGATION FINDINGS
 * ----------------------
 *
 * 1. Blockchain events are external input
 * ---------------------------------------
 * Data received from the Ethereum network must not be treated as trusted
 * application data. Event arguments are validated before they are used for
 * database operations or published to Redis.
 *
 *
 * 2. Viem callbacks must remain synchronous
 * -----------------------------------------
 * Viem expects the `watchEvent` `onLogs` callback to satisfy a synchronous
 * callback contract.
 *
 * An `async` callback implicitly returns a Promise and therefore violates
 * the expected callback type under strict TypeScript/ESLint rules.
 *
 * The solution is to keep the Viem callback synchronous and explicitly start
 * asynchronous processing from it using `void`.
 *
 * This is intentional fire-and-forget execution, while the asynchronous
 * processing method remains responsible for handling its own failures.
 *
 *
 * 3. Type safety must be preserved
 * --------------------------------
 * The project uses strict TypeScript and type-aware ESLint configuration.
 *
 * Implicit `any`, unsafe assignments, unsafe calls, and unsafe member access
 * are intentionally not disabled.
 *
 * Blockchain event types should therefore be preserved from the Viem event
 * definition instead of manually converting values to `any` or suppressing
 * ESLint errors.
 *
 *
 * 4. Database is the source of persisted transaction state
 * ---------------------------------------------------------
 * A blockchain Transfer event is not automatically stored as an application
 * transaction.
 *
 * The listener first checks whether the recipient wallet is registered in the
 * application database.
 *
 * Only relevant transactions are persisted through Prisma.
 *
 *
 * 5. Redis is a transport layer, not the source of truth
 * ------------------------------------------------------
 * Redis Pub/Sub is used only to decouple blockchain processing from real-time
 * notification delivery.
 *
 * The architecture is intentionally split into:
 *
 *   Ethereum
 *      |
 *      v
 *   Viem Listener
 *      |
 *      v
 *   Prisma / Database
 *      |
 *      v
 *   Redis Pub/Sub
 *      |
 *      v
 *   Notification Gateway
 *      |
 *      v
 *   WebSocket Client
 *
 * Redis therefore acts as an event transport mechanism and should not be
 * considered the authoritative source of transaction state.
 *
 *
 * 6. Transaction contracts should not be duplicated unnecessarily
 * ----------------------------------------------------------------
 * The application already defines a canonical Transaction model through the
 * generated protobuf schema.
 *
 * Additional ad-hoc transaction interfaces should only exist at boundaries
 * where external data requires runtime validation.
 *
 * The long-term goal is to keep a single canonical transaction contract across
 * the application while treating Redis JSON and blockchain event data as
 * transport representations.
 *
 *
 * 7. JSON serialization creates a type-safety boundary
 * ----------------------------------------------------
 * Transactions published to Redis are serialized using JSON.
 *
 * JSON.parse() returns untrusted runtime data and must therefore be treated as
 * `unknown` rather than trusted application data.
 *
 * Data received from Redis must be validated before accessing transaction
 * properties.
 *
 *
 * 8. WebSocket delivery is intentionally separated
 * -------------------------------------------------
 * This service does not communicate with frontend clients directly.
 *
 * Its only responsibility after persistence is to publish a transaction event
 * to Redis.
 *
 * The Notification Gateway is responsible for consuming Redis events,
 * converting them to the appropriate application/protobuf representation,
 * determining subscribed wallet rooms, and delivering notifications through
 * WebSockets.
 *
 *
 * 9. Strict TypeScript and ESLint are intentional project requirements
 * -------------------------------------------------------------------
 * During the investigation, several unsafe-type warnings were caused by
 * implicit `any` and insufficiently typed external boundaries.
 *
 * The project therefore uses:
 *
 *   - TypeScript `strict: true`
 *   - Type-aware ESLint
 *   - `no-unsafe-assignment`
 *   - `no-unsafe-call`
 *   - `no-unsafe-argument`
 *   - `no-unsafe-return`
 *   - `no-floating-promises`
 *   - `no-misused-promises`
 *
 * These rules are kept enabled intentionally. ESLint errors should be solved
 * by correcting the underlying types or asynchronous control flow rather than
 * by disabling the rules or introducing `any`.
 *
 *
 * CONCLUSION
 * ----------
 * The BlockchainListener is intentionally a small infrastructure component
 * with a single responsibility:
 *
 *   detect relevant blockchain events -> persist them -> publish an event
 *
 * It does not own WebSocket communication, frontend state, or notification
 * delivery.
 *
 * This separation keeps blockchain ingestion, persistence, event transport,
 * and client notification independently testable and prevents Redis or
 * WebSocket concerns from leaking into blockchain processing logic.
 *
 * ============================================================================
 */

import { Injectable, OnModuleInit } from '@nestjs/common';
import {
  createPublicClient,
  http,
  parseAbiItem,
  type PublicClient,
} from 'viem';
import { mainnet } from 'viem/chains';
import { Redis } from 'ioredis';
import { logger } from '@src/utils/logger';

import { PrismaService } from '@src/prisma/prisma.service';
import { WalletRepository } from '@src/wallet/wallet.repository';

const USDT_ADDRESS = '0xdAC17F958D2ee523a2206206994597C13D831ec7' as const;

const transferEvent = parseAbiItem(
  'event Transfer(address indexed from, address indexed to, uint256 value)',
);

@Injectable()
export class BlockchainListener implements OnModuleInit {
  private readonly viemClient: PublicClient;
  private readonly redis: Redis;

  constructor(
    private readonly prisma: PrismaService,
    private readonly walletRepository: WalletRepository,
  ) {
    this.viemClient = createPublicClient({
      chain: mainnet,
      transport: http(process.env.RPC_URL ?? 'https://alchemy.com'),
    });

    this.redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
  }

  onModuleInit(): void {
    this.watchBlockchain();
  }

  private watchBlockchain(): void {
    console.log('📡 [Blockchain] Запущен слушатель событий смарт-контракта...');

    this.viemClient.watchEvent({
      address: USDT_ADDRESS,
      event: transferEvent,

      onLogs: (logs) => {
        void this.handleTransferLogs(logs).catch((error: unknown) => {
          logger.error(error, '[Blockchain] Failed to process transfer logs');
        });
      },
    });
  }

  private async handleTransferLogs(
    logs: readonly {
      args: {
        from?: `0x${string}`;
        to?: `0x${string}`;
        value?: bigint;
      };
      transactionHash: `0x${string}`;
    }[],
  ): Promise<void> {
    for (const log of logs) {
      const { from, to, value } = log.args;

      if (!from || !to || value === undefined) {
        continue;
      }
      const fromAddress = from.toLowerCase();
      const toAddress = to.toLowerCase();
      const activeWallet = await this.walletRepository.findByAddress(toAddress);

      if (!activeWallet) {
        return;
        //activeWallet = await this.walletRepository.createWallet(toAddress);
      }
      console.log(`[Transfer] from: ${from} to: ${to} value: ${value}`);

      const tx = await this.prisma.transaction.create({
        data: {
          txHash: log.transactionHash,
          fromAddress,
          toAddress,
          amount: value.toString(),
          walletId: activeWallet.id,
        },
      });

      await this.redis.publish('NEW_TRANSACTION', JSON.stringify(tx));
    }
  }
}
