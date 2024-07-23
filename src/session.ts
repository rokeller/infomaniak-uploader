import * as core from '@actions/core';
import { Cookie, CookieJar } from 'tough-cookie';
import axios, { Axios, AxiosResponse } from 'axios';
import { readFile, stat } from 'fs/promises';
import FormData from 'form-data';
import { HttpsCookieAgent } from 'http-cookie-agent/http';
import { randomUUID } from 'crypto';
import { wrapper } from 'axios-cookiejar-support';

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

export interface UploadResult {
    success: boolean;
    localPath: string;
}

interface ResponseBase {
    result: string;
    message: string;
}

interface ListResponse {
    sPath: string;
    aLines?: ListLine[];
    aQuotas?: Quotas;
}

interface Quotas {
    site?: Quota;
    user?: Quota;
}

interface Quota {
    pourcent: number;
    pourcent_free: number;
    used: string;
    total: string
}

interface ListLine {
    sName: string;
    writable: boolean;
    renameable: boolean;
}

interface UploadResponse extends ResponseBase {
    success: boolean;
    name: string;
    uploadName: string;
}

type ApiAction =
    | 'set_language'
    | 'update_tree_list'
    | 'add_folder'
    | 'remove_file_or_folder';

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

export class Session {
    private readonly jar: CookieJar;
    private readonly axios: Axios;

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

    public async remove(path: string): Promise<void> {
        const resp = await this.callApi<ResponseBase>('remove_file_or_folder', {
            aPathToRemove: `["${path}"]`,
            other: 'fullpath',
        });

        core.debug(
            `remove_file_or_folder result for '${path}': ${JSON.stringify(
                resp.data
            )}`
        );

        if (!isSuccess(resp.data)) {
            throw new Error(
                `remove failed for '${path}': ${resp.data.message}`
            );
        }
    }

    public async cd(folderName: string): Promise<ChangeDirResult> {
        let pathSegments = folderName.replace(/^\/|\/$/gi, '').split(/\//gi);
        if (pathSegments.length === 1 && pathSegments[0] === '') {
            pathSegments = [];
        }
        const jsPath = JSON.stringify(pathSegments);

        const resp = await this.callApi<ListResponse>('update_tree_list', {
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

        core.debug(
            `update_tree_list result for '${folderName}': ${JSON.stringify(
                resp.data
            )}`
        );

        if (folderName === '/') {
            const quota = translateQuota(resp.data.aQuotas?.site);
            if (undefined !== quota) {
                core.info(`Quota: used ${quota.used} (${quota.pourcent}%) of ${quota.total} total, ${quota.pourcent_free}% free.`);
            }
        }

        return res;
    }

    public async upload(localPath: string): Promise<UploadResult> {
        const segments = localPath.split(/\//gi);
        const fileName = segments.at(-1);
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
            localPath,
        };

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
        action: ApiAction,
        parameters: NonNullable<unknown>
    ): Promise<AxiosResponse<T, NonNullable<unknown>>> {
        return await this.postFormData<T>('/ftp/ajax/api.php', {
            ...parameters,
            action,
        });
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
}
