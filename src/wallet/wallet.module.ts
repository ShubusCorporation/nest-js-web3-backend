import { Module } from '@nestjs/common';
import { WalletRepository } from './wallet.repository';
import { WalletService } from './wallet.service';
import { WalletController } from './wallet.controller';

@Module({
  providers: [WalletRepository, WalletService, WalletController],
  exports: [WalletController], // Экспортируем, чтобы забрать в главном файле для gRPC-роутера
})
export class WalletModule {}
