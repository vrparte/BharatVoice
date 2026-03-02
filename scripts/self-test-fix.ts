/* eslint-disable no-console */
import { readFile, writeFile } from 'fs/promises';
import path from 'path';

type IChangeType = 'updated' | 'unchanged' | 'failed';

interface IChangeResult {
  readonly file: string;
  readonly status: IChangeType;
  readonly details: string;
}

const PROJECT_ROOT = path.resolve(__dirname, '..');

const changes: IChangeResult[] = [];

const record = (file: string, status: IChangeType, details: string): void => {
  changes.push({ file, status, details });
  const marker = status === 'updated' ? '✅' : status === 'unchanged' ? 'ℹ️' : '❌';
  console.log(`${marker} ${file}: ${details}`);
};

const resolvePath = (relativePath: string): string => {
  return path.join(PROJECT_ROOT, relativePath);
};

const ensurePackageScripts = async (): Promise<void> => {
  const relativePath = 'package.json';
  try {
    const packagePath = resolvePath(relativePath);
    const packageJson = JSON.parse(await readFile(packagePath, 'utf8')) as {
      scripts?: Record<string, string>;
    };

    const desiredScripts: Record<string, string> = {
      'dev:demo': 'cross-env NODE_ENV=development ts-node src/modes/web-demo/server.ts',
      'dev:demo:watch':
        'cross-env NODE_ENV=development nodemon --watch src --ext ts,json src/modes/web-demo/server.ts',
      'start:demo': 'node dist/modes/web-demo/server.js',
      'build:demo': 'tsc -p tsconfig.json --outDir dist',
      'test:demo': 'jest tests/modes/web-demo --passWithNoTests',
      'test:demo:watch': 'jest tests/modes/web-demo --watch --passWithNoTests',
      'test:verticals': 'jest tests/core/verticals --passWithNoTests',
      test: 'jest --passWithNoTests --coverage'
    };

    const scripts = packageJson.scripts ?? {};
    let changed = false;
    for (const [name, value] of Object.entries(desiredScripts)) {
      if (scripts[name] !== value) {
        scripts[name] = value;
        changed = true;
      }
    }

    packageJson.scripts = scripts;

    if (changed) {
      await writeFile(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`, 'utf8');
      record(relativePath, 'updated', 'Script set aligned with demo self-test expectations');
    } else {
      record(relativePath, 'unchanged', 'Scripts already aligned');
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown package.json update error';
    record(relativePath, 'failed', message);
  }
};

const ensureEnvExampleVars = async (): Promise<void> => {
  const relativePath = '.env.example';
  try {
    const envPath = resolvePath(relativePath);
    let content = await readFile(envPath, 'utf8');
    const additions: string[] = [];

    if (!content.includes('BV_DEMO_PORT=')) {
      additions.push('BV_DEMO_PORT=3001');
    }
    if (!content.includes('BV_DEMO_WS_PORT=')) {
      additions.push('BV_DEMO_WS_PORT=3001');
    }
    if (!content.includes('BV_SARVAM_API_KEY=')) {
      additions.push('BV_SARVAM_API_KEY=your_sarvam_api_key');
    }

    if (additions.length > 0) {
      if (!content.endsWith('\n')) {
        content += '\n';
      }
      content += `${additions.join('\n')}\n`;
      await writeFile(envPath, content, 'utf8');
      record(relativePath, 'updated', `Added ${additions.length} missing variable(s)`);
    } else {
      record(relativePath, 'unchanged', 'Required demo variables already present');
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown .env.example update error';
    record(relativePath, 'failed', message);
  }
};

const ensureTsConfigIncludesWebDemo = async (): Promise<void> => {
  const relativePath = 'tsconfig.json';
  try {
    const configPath = resolvePath(relativePath);
    const tsConfig = JSON.parse(await readFile(configPath, 'utf8')) as {
      include?: string[];
    };
    const include = tsConfig.include ?? [];
    const hasCoverage = include.some((entry) => entry === 'src/**/*.ts' || entry.includes('src/modes/web-demo'));

    if (hasCoverage) {
      record(relativePath, 'unchanged', 'Include patterns already cover web-demo sources');
      return;
    }

    tsConfig.include = [...include, 'src/modes/web-demo/**/*.ts'];
    await writeFile(configPath, `${JSON.stringify(tsConfig, null, 2)}\n`, 'utf8');
    record(relativePath, 'updated', 'Added src/modes/web-demo/**/*.ts to include');
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown tsconfig update error';
    record(relativePath, 'failed', message);
  }
};

const ensureJestConfigSettings = async (): Promise<void> => {
  const relativePath = 'jest.config.ts';
  try {
    const jestPath = resolvePath(relativePath);
    let content = await readFile(jestPath, 'utf8');
    let changed = false;

    if (!content.includes("testMatch: ['**/tests/**/*.test.ts']")) {
      content = content.replace(
        /testMatch:\s*\[[^\]]*\],/,
        "testMatch: ['**/tests/**/*.test.ts'],"
      );
      changed = true;
    }

    if (!content.includes("modulePathIgnorePatterns: ['<rootDir>/dist/']")) {
      content = content.replace(
        /testMatch:[^\n]*\n/,
        "testMatch: ['**/tests/**/*.test.ts'],\n  modulePathIgnorePatterns: ['<rootDir>/dist/'],\n"
      );
      changed = true;
    }

    if (changed) {
      await writeFile(jestPath, content, 'utf8');
      record(relativePath, 'updated', 'Applied required jest demo test settings');
    } else {
      record(relativePath, 'unchanged', 'Jest settings already aligned');
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown jest config update error';
    record(relativePath, 'failed', message);
  }
};

const printSummary = (): void => {
  const updated = changes.filter((change) => change.status === 'updated').length;
  const unchanged = changes.filter((change) => change.status === 'unchanged').length;
  const failed = changes.filter((change) => change.status === 'failed').length;

  console.log('');
  console.log(`Fix summary: updated=${updated}, unchanged=${unchanged}, failed=${failed}`);
  if (failed > 0) {
    console.log('Some fixes failed. Review the errors above and patch manually.');
  } else if (updated > 0) {
    console.log('Automated fixes applied successfully.');
  } else {
    console.log('No fixes were needed.');
  }
};

const main = async (): Promise<void> => {
  await ensurePackageScripts();
  await ensureEnvExampleVars();
  await ensureTsConfigIncludesWebDemo();
  await ensureJestConfigSettings();
  printSummary();
};

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown self-test-fix runtime error';
  console.error(`❌ self-test-fix failed: ${message}`);
  process.exitCode = 1;
});
