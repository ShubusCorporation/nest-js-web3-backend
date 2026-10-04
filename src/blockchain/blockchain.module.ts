import { Module } from '@nestjs/common';
import { BlockchainListener } from './blockchain.listener';
import { WalletModule } from '@src/wallet/wallet.module';

@Module({
  imports: [WalletModule],
  providers: [BlockchainListener],
})
export class BlockchainModule {}
