import { Module } from '@nestjs/common';
import { BlockchainListener } from './blockchain.listener';

@Module({
  providers: [BlockchainListener],
})
export class BlockchainModule {}
