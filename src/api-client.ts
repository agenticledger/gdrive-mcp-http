/**
 * Google Drive API Client
 * Auth: Takes a Google OAuth refresh token, exchanges for access token per request.
 * Base URL: https://www.googleapis.com/drive/v3
 */

const BASE_URL = 'https://www.googleapis.com/drive/v3';
const UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

export class GDriveClient {
  private refreshToken: string;
  private clientId: string;
  private clientSecret: string;
  private cachedAccessToken: string | null = null;
  private tokenExpiresAt: number = 0;

  constructor(refreshToken: string, clientId: string, clientSecret: string) {
    this.refreshToken = refreshToken;
    this.clientId = clientId;
    this.clientSecret = clientSecret;
  }

  private async getAccessToken(): Promise<string> {
    // Use cached token if still valid (with 60s buffer)
    if (this.cachedAccessToken && Date.now() < this.tokenExpiresAt - 60_000) {
      return this.cachedAccessToken;
    }

    const response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: this.refreshToken,
        client_id: this.clientId,
        client_secret: this.clientSecret,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Google token refresh failed (${response.status}): ${text}`);
    }

    const data = await response.json() as { access_token: string; expires_in: number };
    this.cachedAccessToken = data.access_token;
    this.tokenExpiresAt = Date.now() + data.expires_in * 1000;
    return data.access_token;
  }

  private async request<T>(
    method: string,
    endpoint: string,
    params?: Record<string, string | number | boolean | undefined>,
    body?: any,
    baseUrl: string = BASE_URL,
  ): Promise<T> {
    const accessToken = await this.getAccessToken();
    const url = new URL(`${baseUrl}${endpoint}`);

    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) {
          url.searchParams.append(key, String(value));
        }
      });
    }

    const options: RequestInit = {
      method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    };

    const response = await fetch(url.toString(), options);

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Drive API Error ${response.status}: ${text}`);
    }

    if (response.status === 204) return {} as T;
    return response.json();
  }

  private async requestRaw(
    method: string,
    endpoint: string,
    params?: Record<string, string | number | boolean | undefined>,
    baseUrl: string = BASE_URL,
  ): Promise<string> {
    const accessToken = await this.getAccessToken();
    const url = new URL(`${baseUrl}${endpoint}`);

    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) {
          url.searchParams.append(key, String(value));
        }
      });
    }

    const response = await fetch(url.toString(), {
      method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Drive API Error ${response.status}: ${text}`);
    }

    return response.text();
  }

  // === Search Files ===

  async searchFiles(query: string, maxResults = 10, pageToken?: string) {
    return this.request<any>('GET', '/files', {
      q: query,
      pageSize: maxResults,
      pageToken,
      fields: 'nextPageToken,files(id,name,mimeType,size,modifiedTime,parents,webViewLink,owners)',
    });
  }

  // === Get File Metadata ===

  async getFile(fileId: string) {
    return this.request<any>('GET', `/files/${encodeURIComponent(fileId)}`, {
      fields: 'id,name,mimeType,size,modifiedTime,createdTime,parents,webViewLink,owners,shared,description,starred',
    });
  }

  // === Get File Content ===
  // For Google Docs/Sheets/Slides: exports in the specified format
  // For binary/text files: downloads raw content

  async getFileContent(fileId: string, mimeType: string): Promise<string> {
    // Google Workspace documents need export
    const exportMimeTypes: Record<string, string> = {
      'application/vnd.google-apps.document': 'text/plain',
      'application/vnd.google-apps.spreadsheet': 'text/csv',
      'application/vnd.google-apps.presentation': 'text/plain',
      'application/vnd.google-apps.drawing': 'image/svg+xml',
    };

    const exportMime = exportMimeTypes[mimeType];

    if (exportMime) {
      // Export Google Workspace doc
      return this.requestRaw('GET', `/files/${encodeURIComponent(fileId)}/export`, {
        mimeType: exportMime,
      });
    } else {
      // Download regular file
      return this.requestRaw('GET', `/files/${encodeURIComponent(fileId)}`, {
        alt: 'media',
      });
    }
  }

  // === List Files in Folder ===

  async listFiles(folderId: string = 'root', maxResults = 20, pageToken?: string) {
    const query = `'${folderId}' in parents and trashed = false`;
    return this.request<any>('GET', '/files', {
      q: query,
      pageSize: maxResults,
      pageToken,
      orderBy: 'folder,name',
      fields: 'nextPageToken,files(id,name,mimeType,size,modifiedTime,parents,webViewLink)',
    });
  }

  // === Create Folder ===

  async createFolder(name: string, parentId?: string) {
    const metadata: any = {
      name,
      mimeType: 'application/vnd.google-apps.folder',
    };
    if (parentId) {
      metadata.parents = [parentId];
    }
    return this.request<any>('POST', '/files', undefined, metadata);
  }

  // === Upload Text File ===

  async uploadFile(name: string, content: string, mimeType: string = 'text/plain', parentId?: string) {
    const accessToken = await this.getAccessToken();

    const metadata: any = { name };
    if (parentId) metadata.parents = [parentId];

    const boundary = '-------314159265358979323846';
    const delimiter = `\r\n--${boundary}\r\n`;
    const closeDelimiter = `\r\n--${boundary}--`;

    const multipartBody =
      delimiter +
      'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
      JSON.stringify(metadata) +
      delimiter +
      `Content-Type: ${mimeType}\r\n\r\n` +
      content +
      closeDelimiter;

    const response = await fetch(`${UPLOAD_URL}/files?uploadType=multipart&fields=id,name,mimeType,size,webViewLink`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body: multipartBody,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Drive upload error ${response.status}: ${text}`);
    }

    return response.json();
  }

  // === Share File ===

  async shareFile(fileId: string, email: string, role: string = 'reader') {
    return this.request<any>('POST', `/files/${encodeURIComponent(fileId)}/permissions`, undefined, {
      type: 'user',
      role,
      emailAddress: email,
    });
  }

  // === Trash File ===

  async trashFile(fileId: string) {
    return this.request<any>('PATCH', `/files/${encodeURIComponent(fileId)}`, undefined, {
      trashed: true,
    });
  }

  // === Update File (content and/or metadata) ===

  async updateFile(
    fileId: string,
    opts: {
      name?: string;
      content?: string;
      mimeType?: string;
      description?: string;
      starred?: boolean;
    },
  ) {
    if (opts.content) {
      const accessToken = await this.getAccessToken();
      const metadata: any = {};
      if (opts.name) metadata.name = opts.name;
      if (opts.description !== undefined) metadata.description = opts.description;
      if (opts.starred !== undefined) metadata.starred = opts.starred;

      const contentMimeType = opts.mimeType || 'text/plain';
      const boundary = '-------314159265358979323846';
      const delimiter = `\r\n--${boundary}\r\n`;
      const closeDelimiter = `\r\n--${boundary}--`;

      const body =
        delimiter +
        'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
        JSON.stringify(metadata) +
        delimiter +
        `Content-Type: ${contentMimeType}\r\n\r\n` +
        opts.content +
        closeDelimiter;

      const response = await fetch(
        `${UPLOAD_URL}/files/${encodeURIComponent(fileId)}?uploadType=multipart&fields=id,name,mimeType,size,modifiedTime,webViewLink`,
        {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': `multipart/related; boundary=${boundary}`,
          },
          body,
        },
      );

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Drive API Error ${response.status}: ${text}`);
      }

      return response.json();
    } else {
      const metadata: any = {};
      if (opts.name) metadata.name = opts.name;
      if (opts.description !== undefined) metadata.description = opts.description;
      if (opts.starred !== undefined) metadata.starred = opts.starred;

      return this.request<any>(
        'PATCH',
        `/files/${encodeURIComponent(fileId)}`,
        { fields: 'id,name,mimeType,size,modifiedTime,webViewLink' },
        metadata,
      );
    }
  }

  // === List Permissions ===

  async listPermissions(fileId: string) {
    return this.request<any>(
      'GET',
      `/files/${encodeURIComponent(fileId)}/permissions`,
      { fields: 'permissions(id,type,role,emailAddress,displayName,domain)' },
    );
  }
}
