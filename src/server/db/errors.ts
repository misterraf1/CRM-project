import { MongoServerError } from "mongodb";

/** A unique index rejected the write (MongoDB error 11000). */
export const isDuplicateKey = (e: unknown): e is MongoServerError => e instanceof MongoServerError && e.code === 11000;
