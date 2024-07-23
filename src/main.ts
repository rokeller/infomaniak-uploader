import * as core from '@actions/core';
import { Session } from './session';
import { Uploader } from './uploader';

async function run(): Promise<void> {
    try {
        core.setSecret('ftpPassword');

        const ftpServer = core.getInput('ftpServer', {
            required: true,
            trimWhitespace: true,
        });
        const ftpUser = core.getInput('ftpUser', { required: true });
        const ftpPassword = core.getInput('ftpPassword', { required: true });
        const localRoot = core.getInput('localRoot', {
            required: true,
            trimWhitespace: true,
        });
        const remoteRoot = core.getInput('remoteRoot', {
            required: false,
            trimWhitespace: true,
        });

        const session = new Session({
            baseUrl: 'https://manager.infomaniak.com',
            server: ftpServer,
            username: ftpUser,
            password: ftpPassword,
        });
        const uploader = new Uploader(localRoot, remoteRoot, session);

        core.info('Starting upload ...');
        const start = new Date();
        core.debug(start.toTimeString());
        await uploader.upload();
        const end = new Date();
        core.debug(end.toTimeString());
        const durationMs = end.valueOf() - start.valueOf();
        core.info(`Upload finished in ${Math.round(durationMs / 100) / 10} sec`)
        // Get the quota again to show stats after upload.
        session.cd('/');
    } catch (error) {
        if (error instanceof Error) {
            core.setFailed(error.message);
        }
    }
}

run();
