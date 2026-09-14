import 'dotenv/config';
import { logger } from '@src/utils/logger';
import * as http2 from 'node:http2';
import { connectNodeAdapter } from '@connectrpc/connect-node';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js'; // Ваш корневой NestJS модуль
import { WalletService } from '@src/generated/proto/src/proto/wallet-service_pb';
import { WalletController } from '@src/wallet/wallet.controller';

const PORT = process.env.PORT || 8080;

// Описываем bootstrap-функцию, которая вернет готовый HTTP/2 сервер
async function bootstrap() {
  // 1. Инициализируем NestJS контекст (без встроенного HTTP сервера)
  logger.info('Starting NestJS IoC container...');
  const app = await NestFactory.createApplicationContext(AppModule);

  // 2. Достаем инстанс контроллера из контейнера NestJS (со всеми DI зависимостями)
  const walletController = app.get(WalletController);

  // 3. Создаем адаптер ConnectRPC и связываем методы с NestJS контроллером
  const handler = connectNodeAdapter({
    routes(router) {
      router.service(WalletService, {
        // Проксируем gRPC запросы в методы нашего инжектируемого NestJS-класса
        getTransactions: (req) => walletController.getTransactions(req),
        streamTransactions: (req) => walletController.streamTransactions(req),
      });
    },
  });

  // 4. Инициализируем HTTP/2 сервер
  const server = http2.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Connect-Protocol-Version, Content-Type, X-Grpc-Web, X-User-Agent',
    );

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    handler(req, res);
  });

  // 5. Запускаем прослушивание порта
  server.listen(PORT, () => {
    logger.info(
      `🚀 ConnectRPC (gRPC-Web) server running at http://localhost:${PORT}`,
    );
  });

  // Возвращаем функцию для закрытия NestJS контекста при остановке (опционально для чистого выхода)
  return app;
}

/**
 * Handles unexpected process terminations gracefully
 */
function handleFatalError(message: string, error: unknown): void {
  logger.fatal(
    { err: error instanceof Error ? error : new Error(String(error)) },
    message,
  );

  setTimeout(() => {
    process.exit(1);
  }, 100);
}

// Перехват критических ошибок вне потока выполнения
process.on('uncaughtException', (err) =>
  handleFatalError('Uncaught exception detected', err),
);
process.on('unhandledRejection', (reason) =>
  handleFatalError('Unhandled promise rejection detected', reason),
);

// Initializing application for CommonJS (top-level await is not supported)
function main() {
  logger.info('Initializing application bootstrap sequence...');

  bootstrap()
    .then(() => {
      logger.info(
        'Application successfully initialized and ready to accept connections.',
      );
    })
    .catch((err) => {
      handleFatalError('Failed to bootstrap the application', err);
    });
}

main();
