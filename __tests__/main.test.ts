import {
    beforeAll,
    beforeEach,
    describe,
    expect,
    it,
    jest,
} from '@jest/globals';
import axios from 'axios';
import * as cp from 'child_process';
import { randomUUID } from 'crypto';
import { rm, writeFile } from 'fs/promises';
import * as path from 'path';
import * as process from 'process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

jest.setTimeout(30 * 1000);

async function createTestFile(relPath: string) {
    const testFile = path.join(__dirname, relPath);
    const testData = randomUUID();

    await writeFile(testFile, testData);

    return testData;
}

async function deleteTestFile(relPath: string) {
    const testFile = path.join(__dirname, relPath);

    await rm(testFile, { force: true });
}

function runAction() {
    const np = process.execPath;
    const ip = path.join(__dirname, '..', 'dist', 'index.js');
    const options: cp.ExecFileSyncOptions = {
        env: process.env,
    };

    try {
        const output = cp.execFileSync(np, [ip], options).toString();
        console.log('stdout:');
        console.log(output);
    } catch (err: unknown) {
        const spawnErr = err as cp.SpawnSyncReturns<Buffer>;
        console.log('Error:');
        console.log('*** stdout:');
        console.log(spawnErr.stdout.toString());
        console.log('*** stderr:');
        console.log(spawnErr.stderr.toString());
    }
}

describe('infomaniak-upload action', () => {
    beforeAll(() => {
        axios.defaults.validateStatus = () => true;
    });

    beforeEach(() => {
        process.env['INPUT_FTPSERVER'] = process.env['FTP_SERVER'];
        process.env['INPUT_FTPUSER'] = process.env['FTP_USER'];
        process.env['INPUT_FTPPASSWORD'] = process.env['FTP_PASS'];
    });

    it('uploads a single file', async () => {
        process.env['INPUT_LOCALROOT'] = path.join(__dirname, 'data');
        process.env['INPUT_REMOTEROOT'] = '/test';

        const validationUrl = path.join(
            process.env['VERIFY_BASE_URL'] || '',
            'test/test.txt'
        );
        const testData = await createTestFile('data/test.txt');

        runAction();

        // validate that we can find the correct contents in the file.
        const resp = await axios.get<string>(validationUrl);
        expect(resp.data).toBe(testData);
    });

    it('deletes old untouched files', async () => {
        process.env['INPUT_LOCALROOT'] = path.join(__dirname, 'cleanup');
        process.env['INPUT_REMOTEROOT'] = '/test/cleanup';
        process.env['INPUT_CLEANUPDIRS'] = '/test/cleanup';

        const validationUrlBase = path.join(
            process.env['VERIFY_BASE_URL'] || '',
            'test/cleanup/'
        );
        await Promise.all([
            createTestFile('cleanup/old.txt'),
            deleteTestFile('cleanup/new.txt'),
        ]);

        runAction();

        // validate that we can find the old file.
        let resp = await axios.get<string>(validationUrlBase + 'old.txt');
        expect(resp.status).toBe(200);

        // remove the old file, add a new file and run the action again.
        await Promise.all([
            deleteTestFile('cleanup/old.txt'),
            createTestFile('cleanup/new.txt'),
        ]);
        runAction();

        // make sure the old file is no longer there, but the new file is.
        resp = await axios.get<string>(validationUrlBase + 'new.txt');
        expect(resp.status).toBe(200);
        resp = await axios.get<string>(validationUrlBase + 'old.txt');
        expect(resp.status).toBe(404);
    });
});
