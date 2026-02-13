import { requestUrl, RequestUrlResponse } from "obsidian";

export const SMARTSYNC_HEADERS = { "Cache-Control": "no-cache, no-store, must-revalidate" };

export interface SmartSyncConfig {
    serverUrl: string;
    port: number;
    authToken?: string;
}

export interface ChecksumsResponse {
    checksums: Record<string, string>;
    file_count: number;
}

export interface StatusResponse {
    online: boolean;
    file_count: number;
}

export interface SuccessResponse {
    success: boolean;
}

export interface DeletedResponse {
    deleted: boolean;
}

export interface CreatedResponse {
    created: boolean;
}

export class SmartSyncClient {
    private serverUrl: string;
    private port: number;
    private authToken?: string;
    private headers: string | object | undefined;

    constructor(config: SmartSyncConfig) {
        this.serverUrl = config.serverUrl.replace(/\/$/, ""); // Remove trailing slash
        this.port = config.port;
        this.authToken = config.authToken;
        this.headers = { ...SMARTSYNC_HEADERS };
    }

    private createAuthHeader(): string | undefined {
        if (this.authToken) {
            return `Bearer ${this.authToken}`;
        }
        return undefined;
    }

    private createFullUrl(path: string): string {
        const cleanPath = path.startsWith("/") ? path : `/${path}`;
        var port = "";
        if (this.port != 0) {
            port = ":" + this.port;
        }
        return `${this.serverUrl}${port}${cleanPath}`;
    }

    /**
     * Check if server is online and get file count
     */
    async getStatus(): Promise<StatusResponse> {
        try {
            const response = await requestUrl({
                url: this.createFullUrl("/status"),
                method: "GET",
                headers: {
                    ...(this.createAuthHeader() ? { Authorization: this.createAuthHeader() } : {}),
                },
            });
            console.log("SmartSync getStatus response:", response.status, response.json);
            // Validate response structure
            if (!response.json || typeof response.json.online !== "boolean") {
                console.error("Invalid status response structure:", response.json);
                return { online: false, file_count: 0 };
            }
            return response.json;
        } catch (error) {
            console.error("SmartSync getStatus error:", error);
            return { online: false, file_count: 0 };
        }
    }

    /**
     * Download a file
     */
    async getFile(path: string): Promise<{ data: ArrayBuffer; status: number }> {
        const response = await requestUrl({
            url: this.createFullUrl(`/file/${path}`),
            method: "GET",
            headers: {
                ...(this.createAuthHeader() ? { Authorization: this.createAuthHeader() } : {}),
                ...SMARTSYNC_HEADERS,
            },
        });
        return { data: response.arrayBuffer, status: response.status };
    }

    /**
     * Upload a file
     */
    async uploadFile(path: string, content: string | ArrayBuffer): Promise<boolean> {
        try {
            const response = await requestUrl({
                url: this.createFullUrl(`/file/${path}`),
                method: "PUT",
                headers: {
                    ...(this.createAuthHeader() ? { Authorization: this.createAuthHeader() } : {}),
                    "Content-Type": content instanceof ArrayBuffer ? "application/octet-stream" : "text/plain",
                    ...SMARTSYNC_HEADERS,
                },
                body: content,
            });
            return response.status === 200 || response.status === 201;
        } catch (error) {
            return false;
        }
    }

    /**
     * Delete a file
     */
    async deleteFile(path: string): Promise<number> {
        try {
            const response = await requestUrl({
                url: this.createFullUrl(`/file/${path}`),
                method: "DELETE",
                headers: {
                    ...(this.createAuthHeader() ? { Authorization: this.createAuthHeader() } : {}),
                    ...SMARTSYNC_HEADERS,
                },
            });
            return response.status;
        } catch (error) {
            return error.status || 666; // Return error status if available, else 666
        }
    }

    /**
     * Create a folder
     */
    async createFolder(path: string): Promise<boolean> {
        const response = await requestUrl({
            url: this.createFullUrl(`/folder/${path}`),
            method: "PUT",
            headers: {
                ...(this.createAuthHeader() ? { Authorization: this.createAuthHeader() } : {}),
                ...SMARTSYNC_HEADERS,
            },
        });
        return response.status === 200 || response.status === 201;
    }

    /**
     * Delete a folder
     */
    async deleteFolder(path: string): Promise<number> {
        try {
            const response = await requestUrl({
                url: this.createFullUrl(`/folder/${path}`),
                method: "DELETE",
                headers: {
                    ...(this.createAuthHeader() ? { Authorization: this.createAuthHeader() } : {}),
                    ...SMARTSYNC_HEADERS,
                },
            });
            return response.status;
        } catch (error) {
            return error.status || 666;
        }
    }

    /**
     * Get all file checksums from server
     */
    async getChecksums(): Promise<ChecksumsResponse> {
        const response = await requestUrl({
            url: this.createFullUrl("/checksums"),
            method: "GET",
            headers: {
                ...(this.createAuthHeader() ? { Authorization: this.createAuthHeader() } : {}),
            },
        });
        return response.json;
    }

    /**
     * Trigger a rescan of checksums on server
     */
    async triggerRescan(): Promise<{ scanned: boolean; file_count: number; checksums: Record<string, string> }> {
        const response = await requestUrl({
            url: this.createFullUrl("/checksums"),
            method: "PUT",
            headers: {
                ...(this.createAuthHeader() ? { Authorization: this.createAuthHeader() } : {}),
            },
        });
        return response.json;
    }

    /**
     * Check if server is online (exists check equivalent)
     */
    async exists(): Promise<boolean> {
        try {
            const status = await this.getStatus();
            return status.online;
        } catch (error) {
            return false;
        }
    }
}
