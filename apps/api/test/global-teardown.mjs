export default async function globalTeardown() {
  await globalThis.__AXIS_PG__?.stop();
}
