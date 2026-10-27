import { Controller, Get, Res } from "@nestjs/common";
import { Response } from "express";
import { PrismaService } from "./prisma/prisma.service";

@Controller("/")
export class AppController {
  constructor(private prismaService: PrismaService) {}

  @Get("health")
  async health(@Res({ passthrough: true }) res: Response) {
    try {
      // A constant probe is enough to prove the database is reachable; loading
      // every config row on each health check only adds work and transfer.
      await this.prismaService.$queryRaw`SELECT 1`;
      return "OK";
    } catch {
      res.statusCode = 500;
      return "ERROR";
    }
  }
}
