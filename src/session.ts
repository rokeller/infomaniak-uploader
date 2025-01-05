import * as core from '@actions/core';
import axios, { Axios, AxiosResponse } from 'axios';
import { wrapper } from 'axios-cookiejar-support';
import { randomUUID } from 'crypto';
import FormData from 'form-data';
import { readFile, stat } from 'fs/promises';
import { HttpsCookieAgent } from 'http-cookie-agent/http';
import { Cookie, CookieJar } from 'tough-cookie';

export interface SessionOptions {
    baseUrl: string;
    server: string;
    username: string;
    password: string;
}

export interface ChangeDirResult {
    success: boolean;
    currentDir: string;
    subDirs: string[];
}

export interface ListResult {
    success: boolean;
    currentDir: string;
    entries: DirEntry[];
}

export interface DirEntry {
    type: 'file' | 'folder';
    name: string;
}

export interface UploadResult {
    success: boolean;
    currentDir: string;
    filename: string;
    localPath: string;
    remotePath: string;
}

interface ResponseBase {
    result: string;
    message: string;
}

interface ListDirsResponse {
    sPath: string;
    aLines?: DirsListingLine[];
    aQuotas?: Quotas;
}

interface ListContentsResponse {
    aLines?: ContentsListingLine[];
    numberOfRows?: number;
}

interface Quotas {
    site?: Quota;
    user?: Quota;
}

interface Quota {
    pourcent: number;
    pourcent_free: number;
    used: string;
    total: string;
}

interface DirsListingLine {
    sName: string;
    writable: boolean;
    renameable: boolean;
}

interface ContentsListingLine {
    sName?: string;
    sDefaultSize: number; // size in bytes
    sTimestamp: number; // seconds since Unix epoch
    type: 'file' | 'folder';
}

interface UploadResponse extends ResponseBase {
    success: boolean;
    name: string;
    uploadName: string;
}

type LowLevelApiAction =
    | 'set_language'
    | 'update_tree_list'
    | 'add_folder'
    | 'remove_file_or_folder'
    | 'loadFolderSelected';

function isSuccess(resp: ResponseBase): boolean {
    return resp.result === 'success';
}

function translateQuota(q?: Quota): Quota | undefined {
    if (undefined === q) {
        return q;
    }

    // Infomaniak being a mostly French speaking company, they have a weird
    // interface where they use some French terms, and French units for sizes:
    // "Mo" == "mégaoctet" => "million octects" => "million bytes"
    // "Ko" == "kilooctet" => "thousand octects" => "thousand bytes"
    const matcher = /(M|K)o/gi;
    return {
        pourcent: q.pourcent,
        pourcent_free: q.pourcent_free,
        used: q.used.replace(matcher, '$1B'),
        total: q.total.replace(matcher, '$1B'),
    };
}

interface ISession {
    connect(): Promise<void>;
    addFolder(folderName: string): Promise<void>;
    ensureFolder(folderName: string): Promise<void>;
    remove(paths: string[]): Promise<void>;
    cd(folderName: string): Promise<ChangeDirResult>;
    ls(): Promise<ListResult>;
    upload(localPath: string): Promise<UploadResult>;
}

type SessionApis = keyof ISession;

export class Session implements ISession {
    private readonly jar: CookieJar;
    private readonly axios: Axios;
    private currentDir: string = '/';

    // TODO: find a better way to describe per-API arguments and results.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
    private apiEventListeners: Map<SessionApis, Function[]> = new Map();

    constructor(private readonly options: SessionOptions) {
        this.jar = new CookieJar();

        this.axios = wrapper(
            axios.create({
                httpsAgent: new HttpsCookieAgent({
                    cookies: { jar: this.jar },
                    keepAlive: true,
                    maxSockets: 8,
                }),
                baseURL: options.baseUrl,
                withCredentials: true,
            })
        );
    }

    // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
    public subscribeApiResult(api: SessionApis, handler: Function) {
        const handlers = this.apiEventListeners.get(api) || [];
        handlers.push(handler);
        this.apiEventListeners.set(api, handlers);
    }

    public async connect(): Promise<void> {
        // first, let's set the language to English, so we get meaningful
        // messages and errors. Infomaniak by default uses French ;-)
        const resp = await this.callApi<ResponseBase>('set_language', {
            lang: 'en_GB',
        });

        core.debug(`set_language result: ${JSON.stringify(resp.data)}`);
        if (!isSuccess(resp.data)) {
            core.warning(`set_language failed: ${resp.data.message}`);
        }

        await this.login();
    }

    public async addFolder(folderName: string): Promise<void> {
        const resp = await this.callApi<ResponseBase>('add_folder', {
            foldername: folderName,
            other: 'fullpath',
        });

        core.debug(
            `add_folder result for '${folderName}': ${JSON.stringify(
                resp.data
            )}`
        );

        if (!isSuccess(resp.data)) {
            throw new Error(
                `addFolder failed for '${folderName}': ${resp.data.message}`
            );
        }
    }

    public async ensureFolder(folderName: string): Promise<void> {
        const segments = folderName.replace(/^\/|\/$/gi, '').split(/\//gi);
        const targetDir = getPath();

        function getPath(numSegments?: number): string {
            if (numSegments === undefined) {
                numSegments = segments.length;
            }

            return `/${segments.slice(0, numSegments).join('/')}`;
        }

        let segId = 0;
        let curDir = getPath(segId);
        let changeDirRes = await this.cd(curDir);

        while (curDir !== targetDir) {
            curDir = getPath(segId + 1);

            if (!changeDirRes.subDirs.includes(segments[segId])) {
                await this.addFolder(curDir);
            }

            changeDirRes = await this.cd(curDir);
            ++segId;
            if (curDir !== changeDirRes.currentDir) {
                throw new Error(
                    `expected to be on '${curDir}', but currently on '${changeDirRes.currentDir}!`
                );
            }
        }
    }

    public async remove(paths: string[]): Promise<void> {
        const pathsToRemove = JSON.stringify(paths);
        const resp = await this.callApi<ResponseBase>('remove_file_or_folder', {
            aPathToRemove: pathsToRemove,
        });

        core.debug(
            `remove_file_or_folder result for '${pathsToRemove}': ${JSON.stringify(
                resp.data
            )}`
        );

        if (!isSuccess(resp.data)) {
            throw new Error(
                `remove failed for '${pathsToRemove}': ${resp.data.message}`
            );
        }
    }

    public async cd(folderName: string): Promise<ChangeDirResult> {
        let pathSegments = folderName.replace(/^\/|\/$/gi, '').split(/\//gi);
        if (pathSegments.length === 1 && pathSegments[0] === '') {
            pathSegments = [];
        }
        const jsPath = JSON.stringify(pathSegments);

        const resp = await this.callApi<ListDirsResponse>('update_tree_list', {
            iFrom: 0,
            jsPath,
        });
        // there's also the `bRefresh` property (boolean), indicating if the
        // Refresh button was used. but we don't need that.

        const directories = resp.data.aLines?.map(line => line.sName);
        const res: ChangeDirResult = {
            success: true,
            currentDir: resp.data.sPath,
            subDirs: directories || [],
        };
        this.currentDir = res.currentDir;

        core.debug(
            `update_tree_list result for '${folderName}': ${JSON.stringify(
                resp.data
            )}`
        );

        if (folderName === '/') {
            const quota = translateQuota(resp.data.aQuotas?.site);
            if (undefined !== quota) {
                core.info(
                    `Quota: used ${quota.used} (${quota.pourcent}%) of ${quota.total} total, ${quota.pourcent_free}% free.`
                );
            }
        }

        try {
            await this.notifyApiEventListeners('cd', folderName, res);
        } catch (e) {
            core.warning(`cd listener notification failed: ${e}`);
        }

        return res;
    }

    public async ls(): Promise<ListResult> {
        const resp = await this.callApi<ListContentsResponse>(
            'loadFolderSelected',
            {
                iOffset: 0,
                iCount: 9999,
                sSortOrder: '',
                sSort: 'none',
                sSearch: '',
            }
        );

        const entries: DirEntry[] =
            resp.data.aLines
                ?.filter(entry => entry.sName !== undefined)
                .map(line => ({
                    type: line.type,
                    name: line.sName!,
                })) || [];
        const res: ListResult = {
            success: true,
            currentDir: this.currentDir,
            entries,
        };

        core.debug(
            `loadFolderSelected result for '${this.currentDir}': ${JSON.stringify(
                resp.data
            )}`
        );

        return res;
    }

    public async upload(localPath: string): Promise<UploadResult> {
        const segments = localPath.split(/\//gi);
        const fileName = segments.at(-1)!;
        const fileStat = await stat(localPath);
        const fileSize = fileStat.size;
        const uuid = randomUUID();

        const query = new URLSearchParams({
            qqpartindex: 0,
            qqpartbyteoffset: 0,
            qqchunksize: fileSize,
            qqtotalparts: 1,
            qqtotalfilesize: fileSize,
            qqfilename: fileName,
            qquuid: uuid,
            qqfile: fileName,
        } as NonNullable<unknown>);
        const form = new FormData({ maxDataSize: 2000000 });

        form.append('qqfile', await readFile(localPath), {
            filename: 'blob',
            contentType: 'application/octet-stream',
            knownLength: fileSize,
        });

        // by default, when uploading the FormData, chunked transfer encoding
        // is used, which the server doesn't like (it errors out). so we put
        // the whole body into memory instead, so we can construct the buffer
        // for the body and pass it to axios.
        const body = form.getBuffer();
        const headers = form.getHeaders();
        const targetUrl = `/ftp/ajax/upload.php?${query.toString()}`;
        const cookie = new Cookie({
            key: `qqfilechunk|${fileName}|${fileSize}|2000000`,
            value: `${uuid}|0`,
            expires: new Date(new Date().valueOf() + 5 * 1000),
        });
        await this.jar.setCookie(cookie, 'https://manager.infomaniak.com/');

        const resp = await this.axios.post<UploadResponse>(targetUrl, body, {
            headers,
        });

        core.debug(
            `upload result for '${localPath}': ${JSON.stringify(resp.data)}`
        );
        const res: UploadResult = {
            success: resp.data.success,
            currentDir: this.currentDir,
            filename: fileName,
            localPath,
            remotePath: this.currentDir + fileName,
        };

        try {
            await this.notifyApiEventListeners('upload', localPath, res);
        } catch (e) {
            core.warning(`upload listener notification failed: ${e}`);
        }

        return res;
    }

    private async login(): Promise<void> {
        const resp = await this.postFormData<ResponseBase>(
            '/ftp/ajax/login.php',
            {
                action: 'connect',
                sServer: this.options.server,
                sUser: this.options.username,
                sPwd: this.options.password,
            }
        );

        if (!isSuccess(resp.data)) {
            core.error(`login failed: ${JSON.stringify(resp.data)}`);
            throw new Error(`login failed: ${resp.data.message}`);
        }

        core.debug(`login result: ${JSON.stringify(resp.data)}`);
    }

    private async callApi<T>(
        action: LowLevelApiAction,
        parameters: NonNullable<unknown>
    ): Promise<AxiosResponse<T, NonNullable<unknown>>> {
        const req = {
            ...parameters,
            action,
        };
        return await this.postFormData<T>('/ftp/ajax/api.php', req);
    }

    private async postFormData<T>(
        endpoint: string,
        data: NonNullable<unknown>
    ): Promise<AxiosResponse<T, NonNullable<unknown>>> {
        const params = new URLSearchParams(data);

        return await this.axios.post<T>(endpoint, params.toString(), {
            headers: {
                'content-type': 'application/x-www-form-urlencoded',
            },
            responseType: 'json',
        });
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private async notifyApiEventListeners<KApi extends SessionApis, A extends any[]>(
        api: KApi,
        ...args: A
    ) {
        const listeners = this.apiEventListeners.get(api);
        if (listeners && listeners.length > 0) {
            for (let i = 0; i < listeners.length; i++) {
                const listener = listeners[i];
                await listener.call(null, ...args);
            }
        }
    }
}
