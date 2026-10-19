import { Injectable } from '@nestjs/common';
import { PrismaService } from '@src/prisma/prisma.service';
import { Prisma } from '../generated/prisma/client';

@Injectable()
export class WalletRepository {
  // NestJS автоматически найдет глобальный PrismaService и внедрит его сюда
  constructor(private readonly prisma: PrismaService) {}

  async findByAddress(address: string) {
    return this.prisma.wallet.findUnique({
      where: { address: address.toLowerCase() },
    });
  }

  async getUserWatchedAddresses(address: string) {
    return this.prisma.wallet.findUnique({
      where: { address: address.toLowerCase() },
      select: { address: true },
    });
  }

  async hasAnyAddress(addresses: string[]) {
    const lowerCaseAddresses = addresses.map((addr) => addr.toLowerCase());
    const found = await this.prisma.wallet.findMany({
      where: {
        address: {
          in: lowerCaseAddresses,
        },
      },
      select: { id: true }, // Выбираем только id, чтобы не тащить лишние данные из базы
    });
    return found;
  }

  async createWallet(address: string) {
    return this.prisma.wallet.create({
      data: {
        address: address.toLowerCase(),
      },
    });
  }

  async addWatcher(
    watcher: string,
    wallet: NonNullable<Awaited<ReturnType<WalletRepository['findByAddress']>>>,
  ) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.walletWatcher.create({
          data: {
            userId: watcher,
            walletId: wallet.id,
          },
        });

        return tx.wallet.update({
          where: { id: wallet.id },
          data: {
            watchers: {
              increment: 1,
            },
          },
        });
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002' // Subscription already exists.
      ) {
        return wallet;
      }
      throw error;
    }
  }

  async removeWatcher(
    watcher: string,
    wallet: NonNullable<Awaited<ReturnType<WalletRepository['findByAddress']>>>,
  ) {
    return this.prisma.$transaction(async (tx) => {
      // Use deleteMany to avoid throwing an error if the watcher subscription does not exist.
      const deleted = await tx.walletWatcher.deleteMany({
        where: {
          userId: watcher,
          walletId: wallet.id,
        },
      });

      if (deleted.count === 0) {
        return wallet;
      }

      return tx.wallet.update({
        where: { id: wallet.id },
        data: {
          watchers: {
            decrement: 1,
          },
        },
      });
    });
  }

  private async addWatchers(
    wallet: NonNullable<Awaited<ReturnType<WalletRepository['findByAddress']>>>,
    watchersNumber: number,
  ) {
    const id = wallet.id;

    return this.prisma.wallet.update({
      where: { id },
      data: {
        watchers: {
          increment: watchersNumber,
        },
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
        where: { walletId },
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
