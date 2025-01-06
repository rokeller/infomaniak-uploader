import * as core from '@actions/core';
import { opendir } from 'fs/promises';
import path from 'path';
import { Session, UploadResult } from './session';

export class Uploader {
    constructor(
        private readonly localRootPath: string,
        private readonly remoteRootPath: string,
        private readonly session: Session
    ) { }

    public async upload(): Promise<void> {
        await this.session.connect();
        await this.session.ensureFolder(this.remoteRootPath);
        await this.uploadRecursively(this.localRootPath, this.remoteRootPath);
    }

    private async uploadRecursively(
        localPath: string,
        remotePath: string
    ): Promise<void> {
        try {
            const entries = await opendir(localPath);
            const files: string[] = [];
            const dirs: string[] = [];

            // entries of a directory are in the order in which they're in the inode.
            // but we want to upload files of the directory first, and only then go
            // into the subdirectories, because it's more efficient for FTP that way.
            for await (const fileOrDir of entries) {
                if (fileOrDir.isDirectory()) {
                    dirs.push(fileOrDir.name);
                } else if (fileOrDir.isFile()) {
                    files.push(fileOrDir.name);
                }
            }

            if (files.length === 0 && dirs.length === 0) {
                // if there's no work for us here, then we can just as well leave.
                return;
            }

            const changeDirRes = await this.session.cd(remotePath);
            const pendingUploads: Promise<UploadResult>[] = [];

            for (const file of files) {
                const localFilePath = path.join(localPath, file);
                core.debug(`uploading file: ${localFilePath}`);
                pendingUploads.push(this.session.upload(localFilePath));
            }

            const uploadResults = await Promise.all(pendingUploads);
            for (const uploadResult of uploadResults) {
                if (!uploadResult.success) {
                    core.error(
                        `upload '${uploadResult.localPath}' ... failed.`
                    );
                } else {
                    core.info(
                        `upload '${uploadResult.localPath}' ... success.`
                    );
                }
            }

            // now let's recursively upload the directory's contents too.
            for (const dir of dirs) {
                const localDirPath = path.join(localPath, dir);
                const remoteDirPath = path.join(remotePath, dir);

                if (!changeDirRes.subDirs.includes(dir)) {
                    core.debug(`need to add folder: ${remoteDirPath}`);
                    await this.session.addFolder(remoteDirPath);
                }

                await this.uploadRecursively(localDirPath, remoteDirPath);
            }
        } catch (err) {
            core.error(err as Error);
        }
    }
}
