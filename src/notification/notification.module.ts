import { Module } from '@nestjs/common';
import { NotificationGateway } from './notification.gateway';
import { WalletModule } from '@src/wallet/wallet.module';

@Module({
  imports: [WalletModule],
  providers: [NotificationGateway],
})
export class NotificationModule {}
