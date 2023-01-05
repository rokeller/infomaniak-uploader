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

        core.debug('Starting upload ...');
        core.debug(new Date().toTimeString());
        await uploader.upload();
        core.debug(new Date().toTimeString());
    } catch (error) {
        if (error instanceof Error) {
            core.setFailed(error.message);
        }
    }
}

run();
