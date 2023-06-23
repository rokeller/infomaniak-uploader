import { expect, jest, test } from '@jest/globals';
import axios from 'axios';
import * as cp from 'child_process';
import { randomUUID } from 'crypto';
import { writeFile } from 'fs/promises';
import * as path from 'path';
import * as process from 'process';

jest.setTimeout(30 * 1000);

test('test runs', async () => {
    process.env['INPUT_FTPSERVER'] = process.env['FTP_SERVER'];
    process.env['INPUT_FTPUSER'] = process.env['FTP_USER'];
    process.env['INPUT_FTPPASSWORD'] = process.env['FTP_PASS'];
    process.env['INPUT_LOCALROOT'] = path.join(__dirname, 'data');
    process.env['INPUT_REMOTEROOT'] = '/test';

    const validationUrl = path.join(process.env['VERIFY_BASE_URL'] || '', 'test/test.txt');
    const testFile = path.join(__dirname, 'data/test.txt');
    const testData = randomUUID();

    await writeFile(testFile, testData);

    const np = process.execPath
    const ip = path.join(__dirname, '..', 'lib', 'main.js')
    const options: cp.ExecFileSyncOptions = {
        env: process.env,
    }

    try {
        const output = cp.execFileSync(np, [ip], options).toString()
        console.log('stdout:')
        console.log(output)
    } catch (err) {
        console.log('Error:')
        console.log('*** stdout:')
        console.log((err as any).stdout.toString())
        console.log('*** stderr:')
        console.log((err as any).stderr.toString())
    }

    const resp = await axios.get<string>(validationUrl);
    expect(resp.data).toBe(testData);
});
