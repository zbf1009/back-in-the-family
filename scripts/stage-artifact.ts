import assert from 'node:assert/strict';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { root } from '../worker-api/scripts/profile.ts';
import { assertWorkerTools } from '../worker-api/scripts/tools.ts';
import { artifactCliContext, copyBytes, freshDirectory, prepareArtifact, readClosedTree, verifyArtifactInputs } from './artifact-inputs.ts';
import type { ArtifactExpectation, CheckedInputs } from './artifact-inputs.ts';
import { checkArtifact } from './check-artifact.ts';

/** Copy only verified immutable transport bytes into a fresh public tree. */
export async function stageArtifact(projectRoot: string, inputDir: string, stageDir: string, expected: ArtifactExpectation): Promise<CheckedInputs> {
  const inputs = await verifyArtifactInputs(projectRoot, inputDir, expected);
  await freshDirectory(stageDir);
  await copyBytes(stageDir, await readClosedTree(join(inputDir, 'tree')));
  await checkArtifact(projectRoot, stageDir, inputs, expected.identity);
  // Source freshness is checked again after staging; publishing additionally
  // rechecks its independently read source ref immediately before atomic CAS.
  await verifyArtifactInputs(projectRoot, inputDir, expected);
  return inputs;
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    assertWorkerTools();
    const context = await artifactCliContext(process.argv.slice(2));
    if (context.prepare) {
      assert.ok(!process.argv.includes('--input'), 'Preparation consumes checked source inputs, not another transport');
      const envelopeSHA = await prepareArtifact(root, context.outputDir, context.identity);
      console.log(JSON.stringify({ identity: context.identity, envelopeSHA }));
    } else {
      assert.ok(context.outputDir !== context.inputDir, 'Staging requires an explicit fresh output directory distinct from transport');
      const envelopeSHA = context.envelopeSHA;
      await stageArtifact(root, context.inputDir, context.outputDir, { identity: context.identity, envelopeSHA });
      console.log(JSON.stringify({ identity: context.identity, envelopeSHA }));
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Artifact staging failed (contents redacted)');
    process.exitCode = 1;
  }
}
