export default async function globalTeardown() {
  await globalThis.__AXIS_DB__?.stop();
}
