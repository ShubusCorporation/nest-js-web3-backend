import 'dotenv/config';
import { logger } from '@src/utils/logger';
import * as http from 'node:http';
import { connectNodeAdapter } from '@connectrpc/connect-node';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js'; // Ваш корневой NestJS модуль
import { WalletService } from '@src/generated/proto/src/proto/wallet-service_pb';
import { WalletController } from '@src/wallet/wallet.controller';

const PORT = process.env.PORT || 8080;

// Описываем bootstrap-функцию, которая вернет готовый HTTP/2 сервер
// Описываем bootstrap-функцию, которая инициализирует NestJS и два сервера
async function bootstrap() {
  logger.info('Starting NestJS IoC container as full web application...');

  // 1. Инициализируем полноценное веб-приложение NestJS
  const app = await NestFactory.create(AppModule, { logger: false });

  // 2. Достаем инстанс контроллера кошелька из контейнера NestJS
  const walletController = app.get(WalletController);

  // 3. Создаем стандартный адаптер ConnectRPC (без лишних свойств)
  const handler = connectNodeAdapter({
    routes(router) {
      router.service(WalletService, {
        getTransactions: (req) => walletController.getTransactions(req),
        streamTransactions: (req) => walletController.streamTransactions(req),
        getWatchedAddresses: (req) => walletController.getWatchedAddresses(req),
      });
    },
  });

  // 4. Поднимаем HTTP/2 сервер с ручной, но лаконичной обработкой CORS для ConnectRPC
  const server = http.createServer((req, res) => {
    // Прописываем CORS заголовки для всех входящих ConnectRPC запросов
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Connect-Protocol-Version, Content-Type, X-Grpc-Web, X-User-Agent',
    );

    // Браузер перед POST-запросом всегда присылает проверочный OPTIONS
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // Если всё ок, отдаем запрос в адаптер ConnectRPC
    handler(req, res);
  });

  // Запускаем HTTP/2 сервер для gRPC
  server.listen(PORT, () => {
    logger.info(
      `🚀 ConnectRPC (gRPC-Web) server running at http://localhost:${PORT}`,
    );
  });

  // 5. Запускаем NestJS на порту 8082 для работы Socket.io
  await app.listen(8082, () => {
    logger.info(
      '⚡ NestJS Core engine successfully running at http://localhost:8082',
    );
  });

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
