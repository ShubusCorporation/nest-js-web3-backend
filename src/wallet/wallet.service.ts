import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
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

export interface GetUserTransactionsResult {
  transactions: UserTransaction[];
  totalCount: number;
  hasMore: boolean;
}

@Injectable()
export class WalletService {
  constructor(private readonly repository: WalletRepository) {}

  async getUserTransactions(
    address: string,
    page: number,
    limit: number,
  ): Promise<GetUserTransactionsResult> {
    if (!address || !address.startsWith('0x')) {
      throw new BadRequestException('Неверный формат адреса кошелька');
    }

    const safePage = Math.max(1, page || 1);
    const safeLimit = Math.min(100, Math.max(1, limit || 20));
    const offset = (safePage - 1) * safeLimit;

    const wallet = await this.repository.findByAddress(address);

    if (!wallet) {
      throw new NotFoundException('Кошелек не зарегистрирован в системе');
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
