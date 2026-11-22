import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyArtifactInputs } from '../artifact-inputs.ts';
import { checkArtifact } from '../check-artifact.ts';
import { preparePublication, publishArtifact, publishArtifactCI, publishPreparedLocal } from '../publish-artifact.ts';
import type { PreparedPublication, PublicationOptions } from '../publish-artifact.ts';
import { assertWorkerTools } from '../../worker-api/scripts/tools.ts';

/** Test bridge only: invoke the actual copied APIs in the isolated consumer. */
async function run(): Promise<void> {
  assertWorkerTools();
  const action = process.argv[2];
  const options = JSON.parse(process.argv[3]!) as PublicationOptions;
  let result: unknown;
  switch (action) {
    case 'verify': result = await verifyArtifactInputs(options.projectRoot, options.inputDir, options.expected); break;
    case 'check': {
      const inputs = await verifyArtifactInputs(options.projectRoot, options.inputDir, options.expected);
      const publicDir = (options as PublicationOptions & { publicDir: string }).publicDir;
      await checkArtifact(options.projectRoot, publicDir, inputs, options.expected.identity);
      result = { checked: true }; break;
    }
    case 'publish': result = await publishArtifact(options); break;
    case 'prepare-publication': result = await preparePublication(options); break;
    case 'publish-prepared': result = await publishPreparedLocal(options as PreparedPublication); break;
    case 'publish-ci': result = await publishArtifactCI(options); break;
    default: assert.fail('Unexpected consumer proof action');
  }
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await run().catch(error => { console.error(error instanceof Error ? error.message : 'Consumer proof failed'); process.exitCode = 1; });
}
