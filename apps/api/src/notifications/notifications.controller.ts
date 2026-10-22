import { Controller, Get, HttpCode, Param, Post } from "@nestjs/common";
import { NotificationsService } from "./notifications.service";

@Controller("v1")
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get("notifications")
  list() {
    return this.notifications.list();
  }

  @HttpCode(204)
  @Post("notifications/read-all")
  readAll() {
    return this.notifications.markAllRead();
  }

  @HttpCode(204)
  @Post("notifications/:id/read")
  read(@Param("id") id: string) {
    return this.notifications.markRead(id);
  }

  @Get("me/summary")
  summary() {
    return this.notifications.summary();
  }
}
