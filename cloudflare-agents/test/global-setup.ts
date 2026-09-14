import { startFakeDevin } from "./fake-devin";

export default async function setup(): Promise<() => Promise<void>> {
  const port = Number(process.env.FAKE_DEVIN_PORT);
  const apiKey = process.env.FAKE_DEVIN_API_KEY ?? "";
  const fake = await startFakeDevin(port, apiKey);
  return () => fake.close();
}
