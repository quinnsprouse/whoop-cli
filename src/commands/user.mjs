export async function commandProfile(flags, deps) {
  const { withClient, writeOutput } = deps;
  const client = await withClient(flags);
  const profile = await client.getBasicProfile();
  await writeOutput(profile, { ...flags, json: true });
}

export async function commandBody(flags, deps) {
  const { withClient, writeOutput } = deps;
  const client = await withClient(flags);
  const body = await client.getBodyMeasurement();
  await writeOutput(body, { ...flags, json: true });
}
