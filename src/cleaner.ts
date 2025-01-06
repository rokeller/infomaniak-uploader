import * as core from '@actions/core';
import { ChangeDirResult, DirEntry, Session, UploadResult } from './session';

interface DirContents {
    entries?: Map<string, DirEntry>;
    hasUploads?: boolean;
}

function trimTrailingSlashes(path: string) {
    return path.replace(/\/+$/gi, '');
}

export class Cleaner {
    private readonly cleanupDirsItemsToRemove = new Map<string, DirContents>();

    constructor(
        dirs: string[],
        private readonly session: Session
    ) {
        session.subscribeApiResult('cd', this.onCd.bind(this));
        session.subscribeApiResult('upload', this.onUpload.bind(this));

        dirs.forEach(dir => {
            this.cleanupDirsItemsToRemove.set(trimTrailingSlashes(dir), {});
        });
    }

    public async cleanup() {
        const paths = [... this.cleanupDirsItemsToRemove.keys()];

        for (let i = 0; i < paths.length; i++) {
            const path = paths[i];
            const contents = this.cleanupDirsItemsToRemove.get(path);

            if (!contents || !contents.entries || !contents.hasUploads) {
                // we didn't observe / touch on this directory, so let's leave
                // its contents as-is.
                continue;
            }

            await this.cleanupDirectory(path, contents.entries);
        }
    }

    private async cleanupDirectory(path: string, snapshot: Map<string, DirEntry>) {
        core.info(`cleaning up directory '${path}' ...`);
        const itemsToRemove = [...snapshot.keys()];
        core.debug(`entries to remove: ${itemsToRemove.join('|')}`);

        if (itemsToRemove.length > 0) {
            await this.session.cd(path);
            await this.session.remove(itemsToRemove);
        }
    }

    private async onCd(_folderName: string, result: ChangeDirResult) {
        const mapEntry = this.cleanupDirsItemsToRemove.get(result.currentDir);
        if (mapEntry === undefined || mapEntry.entries !== undefined) {
            // we don't need to cleanup the directory, or we already have the
            // initial snapshot of files.
            return;
        }

        // let's get a snapshot of the files in the directory.
        const res = await this.session.ls();
        const entriesMap = new Map<string, DirEntry>(
            res.entries
                .filter(entry => entry.type === 'file')
                .map(entry => [entry.name, entry])
        );

        this.cleanupDirsItemsToRemove.set(result.currentDir, {
            entries: entriesMap,
        });
    }

    private async onUpload(_localPath: string, result: UploadResult) {
        const mapEntry = this.cleanupDirsItemsToRemove.get(result.currentDir);
        if (mapEntry === undefined || mapEntry.entries === undefined) {
            return;
        }

        mapEntry.hasUploads = true;
        mapEntry.entries.delete(result.filename);
    }
}
