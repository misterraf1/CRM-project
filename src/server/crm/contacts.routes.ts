import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from "@nestjs/common";
import {
  contactCreateSchema,
  contactListQuerySchema,
  contactUpdateSchema,
  noteSchema,
  type ContactCreateInput,
  type ContactListQuery,
  type ContactUpdateInput,
} from "@axis/shared";
import type { z } from "zod";
import { RequirePermission } from "../common/decorators";
import { ZodPipe } from "../common/zod.pipe";
import { ContactsService } from "./contacts.service";

// Every member works with contacts; visibility is narrowed by ownerScope() per role.
@Controller("v1/contacts")
export class ContactsController {
  constructor(private readonly contacts: ContactsService) {}

  @Get()
  list(@Query(new ZodPipe(contactListQuerySchema)) query: ContactListQuery) {
    return this.contacts.list(query);
  }

  @Post()
  create(@Body(new ZodPipe(contactCreateSchema)) body: ContactCreateInput) {
    return this.contacts.create(body);
  }

  @Get(":id")
  get(@Param("id") id: string) {
    return this.contacts.get(id);
  }

  @Patch(":id")
  update(@Param("id") id: string, @Body(new ZodPipe(contactUpdateSchema)) body: ContactUpdateInput) {
    return this.contacts.update(id, body);
  }

  @RequirePermission("contacts.delete")
  @HttpCode(204)
  @Delete(":id")
  remove(@Param("id") id: string) {
    return this.contacts.remove(id);
  }

  @Get(":id/activities")
  activities(@Param("id") id: string) {
    return this.contacts.activities(id);
  }

  @Post(":id/notes")
  addNote(@Param("id") id: string, @Body(new ZodPipe(noteSchema)) body: z.infer<typeof noteSchema>) {
    return this.contacts.addNote(id, body.body);
  }
}
