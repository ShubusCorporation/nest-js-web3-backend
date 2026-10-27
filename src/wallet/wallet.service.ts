import { Injectable, BadRequestException } from '@nestjs/common';
import { WalletRepository } from './wallet.repository';

export interface UserTransaction {
  id: string;
  txHash: string;
  fromAddress: string;
  toAddress: string;
  amount: string;
  timestamp: Date;
  tokenSymbol: string;
}

export interface GetTransactionsResult {
  transactions: UserTransaction[];
  totalCount: number;
  hasMore: boolean;
}

@Injectable()
export class WalletService {
  constructor(private readonly repository: WalletRepository) {}

  async getUserWatchedAddresses(userWallet: string) {
    await this.repository.ensureUserExists(userWallet);
    return await this.repository.getUserWatchedAddresses(userWallet);
  }

  async getTransactions(
    address: string,
    page: number,
    limit: number,
  ): Promise<GetTransactionsResult> {
    if (!address || !address.startsWith('0x')) {
      throw new BadRequestException('Неверный формат адреса кошелька');
    }

    const safePage = Math.max(1, page || 1);
    const safeLimit = Math.min(100, Math.max(1, limit || 20));
    const offset = (safePage - 1) * safeLimit;

    let wallet = await this.repository.findByAddress(address);

    if (!wallet) {
      console.log(`[WalletService] New target wallet! Registering: ${address}`);
      wallet = await this.repository.createWallet(address);
    }

    const [transactions, totalCount] =
      await this.repository.getPaginatedTransactions(
        wallet.id,
        offset,
        safeLimit,
      );

    const hasMore = offset + transactions.length < totalCount;

    return {
      transactions,
      totalCount,
      hasMore,
    };
  }
}
