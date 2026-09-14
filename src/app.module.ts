import { Module } from '@nestjs/common';
import { PrismaModule } from '@src/prisma/prisma.module';
import { WalletModule } from '@src/wallet/wallet.module';
import { BlockchainModule } from '@src/blockchain/blockchain.module';
import { NotificationModule } from '@src/notification/notification.module';

@Module({
  imports: [
    PrismaModule, // Глобальный модуль базы данных
    WalletModule, // Модуль кошелька
    BlockchainModule,
    NotificationModule,
  ],
})
export class AppModule {}
