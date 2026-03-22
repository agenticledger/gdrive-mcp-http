import { z } from 'zod';
import { GDriveClient } from './api-client.js';

interface ToolDef {
  name: string;
  description: string;
  inputSchema: z.ZodType<any>;
  handler: (client: GDriveClient, args: any) => Promise<any>;
}

export const tools: ToolDef[] = [
  // === 1. Search ===
  {
    name: 'gdrive_search',
    description: 'Search files by name, content, or type using Google Drive query syntax (e.g., "name contains \'report\'", "fullText contains \'budget\'", "mimeType = \'application/pdf\'"). Supports standard Drive query operators.',
    inputSchema: z.object({
      query: z.string().describe('Google Drive search query (Drive API q parameter syntax)'),
      max_results: z.number().min(1).max(100).default(20).describe('Max files to return (1-100)'),
      page_token: z.string().optional().describe('Pagination token for next page'),
    }),
    handler: async (client, args) => {
      return client.searchFiles(args.query, args.max_results, args.page_token);
    },
  },

  // === 2. List Files ===
  {
    name: 'gdrive_list_files',
    description: 'List files in a specific folder. Defaults to root folder. Returns file names, types, sizes, and modification dates.',
    inputSchema: z.object({
      folder_id: z.string().default('root').describe('Folder ID to list files from (default: "root" for My Drive root)'),
      max_results: z.number().min(1).max(100).default(20).describe('Max files to return (1-100)'),
      page_token: z.string().optional().describe('Pagination token for next page'),
    }),
    handler: async (client, args) => {
      return client.listFiles(args.folder_id, args.max_results, args.page_token);
    },
  },

  // === 3. Get File Metadata ===
  {
    name: 'gdrive_get_file',
    description: 'Get detailed metadata for a file by its ID, including name, MIME type, size, owners, sharing status, and web link.',
    inputSchema: z.object({
      file_id: z.string().describe('The Google Drive file ID'),
    }),
    handler: async (client, args) => {
      return client.getFile(args.file_id);
    },
  },

  // === 4. Read File Content ===
  {
    name: 'gdrive_read_file',
    description: 'Read or export file content. Google Docs are exported as plain text, Sheets as CSV, Slides as plain text. Other files are downloaded directly. Best for text-based files.',
    inputSchema: z.object({
      file_id: z.string().describe('The Google Drive file ID'),
      export_mime_type: z.string().optional().describe('Override export MIME type (e.g., "text/html", "application/pdf", "text/csv"). Only relevant for Google Workspace files.'),
    }),
    handler: async (client, args) => {
      let mimeType = args.export_mime_type;
      if (!mimeType) {
        const meta = await client.getFile(args.file_id);
        mimeType = meta.mimeType;
      }
      const content = await client.getFileContent(args.file_id, mimeType);
      return { file_id: args.file_id, content };
    },
  },

  // === 5. Create File ===
  {
    name: 'gdrive_create_file',
    description: 'Create a new text-based file in Google Drive. Supports plain text, HTML, CSV, JSON, Markdown, and other text formats.',
    inputSchema: z.object({
      name: z.string().describe('File name (include extension, e.g., "notes.txt", "data.csv", "report.md")'),
      content: z.string().describe('File content (text-based)'),
      mime_type: z.string().default('text/plain').describe('MIME type (e.g., "text/plain", "text/html", "text/csv", "application/json")'),
      parent_id: z.string().optional().describe('Parent folder ID. Omit to create in root.'),
    }),
    handler: async (client, args) => {
      return client.uploadFile(args.name, args.content, args.mime_type, args.parent_id);
    },
  },

  // === 6. Update File ===
  {
    name: 'gdrive_update_file',
    description: 'Update a file\'s content and/or metadata (name, description, starred). Provide content to replace file contents, or just metadata fields to update properties.',
    inputSchema: z.object({
      file_id: z.string().describe('The Google Drive file ID'),
      name: z.string().optional().describe('New file name'),
      content: z.string().optional().describe('New file content (replaces existing content)'),
      mime_type: z.string().optional().describe('MIME type for the new content'),
      description: z.string().optional().describe('New file description'),
      starred: z.boolean().optional().describe('Star or unstar the file'),
    }),
    handler: async (client, args) => {
      return client.updateFile(args.file_id, {
        name: args.name,
        content: args.content,
        mimeType: args.mime_type,
        description: args.description,
        starred: args.starred,
      });
    },
  },

  // === 7. Delete File (Trash) ===
  {
    name: 'gdrive_delete_file',
    description: 'Move a file to the trash. The file can be recovered from trash within 30 days.',
    inputSchema: z.object({
      file_id: z.string().describe('The Google Drive file ID to trash'),
    }),
    handler: async (client, args) => {
      await client.trashFile(args.file_id);
      return { status: 'trashed', file_id: args.file_id };
    },
  },

  // === 8. List Shared With Me ===
  {
    name: 'gdrive_list_shared',
    description: 'List files that have been shared with the authenticated user.',
    inputSchema: z.object({
      max_results: z.number().min(1).max(100).default(20).describe('Max files to return (1-100)'),
      page_token: z.string().optional().describe('Pagination token for next page'),
    }),
    handler: async (client, args) => {
      return client.searchFiles('sharedWithMe = true and trashed = false', args.max_results, args.page_token);
    },
  },

  // === 9. Share File ===
  {
    name: 'gdrive_share_file',
    description: 'Share a file with someone by email. Supports reader, writer, and commenter roles.',
    inputSchema: z.object({
      file_id: z.string().describe('The Google Drive file ID to share'),
      email: z.string().describe('Email address of the person to share with'),
      role: z.enum(['reader', 'writer', 'commenter']).describe('Permission role: "reader" (view only), "writer" (can edit), "commenter" (can comment)'),
    }),
    handler: async (client, args) => {
      return client.shareFile(args.file_id, args.email, args.role);
    },
  },

  // === 10. Create Folder ===
  {
    name: 'gdrive_create_folder',
    description: 'Create a new folder in Google Drive.',
    inputSchema: z.object({
      name: z.string().describe('Folder name'),
      parent_id: z.string().optional().describe('Parent folder ID. Omit to create in root.'),
    }),
    handler: async (client, args) => {
      return client.createFolder(args.name, args.parent_id);
    },
  },
];
