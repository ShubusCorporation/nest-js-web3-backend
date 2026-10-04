import { Injectable } from '@nestjs/common';
import { PrismaService } from '@src/prisma/prisma.service';

@Injectable()
export class WalletRepository {
  // NestJS автоматически найдет глобальный PrismaService и внедрит его сюда
  constructor(private readonly prisma: PrismaService) {}

  async findByAddress(address: string) {
    return this.prisma.wallet.findUnique({
      where: { address: address.toLowerCase() },
    });
  }

  async createWallet(address: string) {
    return this.prisma.wallet.create({
      data: {
        address: address.toLowerCase(),
      },
    });
  }

  async getPaginatedTransactions(
    walletId: string,
    offset: number,
    limit: number,
  ) {
    return this.prisma.$transaction([
      this.prisma.transaction.findMany({
        // where: { walletId },
        orderBy: { timestamp: 'desc' },
        skip: offset,
        take: limit,
      }),
      this.prisma.transaction.count({
        where: { walletId },
      }),
    ]);
  }
}
