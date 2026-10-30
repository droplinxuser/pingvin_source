import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
} from "@nestjs/common";
import { Throttle, SkipThrottle } from "@nestjs/throttler";
import { Request, Response } from "express";
import { getEdgeCacheHeaders } from "src/utils/cache.util";
import { ContactService } from "./contact.service";
import { SendContactMessageDTO } from "./dto/sendContactMessage.dto";

@Controller("contact")
export class ContactController {
  constructor(private readonly contactService: ContactService) {}

  /** Public Turnstile site key and availability for the contact page. */
  @Get("config")
  @SkipThrottle({ default: true })
  config(@Res({ passthrough: true }) response: Response) {
    response.set(getEdgeCacheHeaders(60));
    return this.contactService.publicConfig();
  }

  @Post()
  @HttpCode(202)
  @Throttle({ default: { limit: 5, ttl: 60 * 1000 } })
  async send(
    @Body() body: SendContactMessageDTO,
    @Req() request: Request,
  ): Promise<{ queued: true }> {
    await this.contactService.send(body, request.ip);
    return { queued: true };
  }
}
