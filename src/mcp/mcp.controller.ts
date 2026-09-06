import { Controller, Delete, Get, Post, Req, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Request, Response } from 'express';
import { McpServerFactory } from './mcp-server.factory';

const JSON_RPC_METHOD_NOT_ALLOWED = {
  jsonrpc: '2.0' as const,
  error: { code: -32000, message: 'Method not allowed.' },
  id: null,
};

const JSON_RPC_INTERNAL_ERROR = {
  jsonrpc: '2.0' as const,
  error: { code: -32603, message: 'Internal server error' },
  id: null,
};

// Exposes contrib-radar as an MCP server over the Streamable HTTP
// transport, same stateless-per-request pattern as packetforge's
// McpController (a fresh McpServer + transport per request, matching the
// SDK's own stateless example) - every tool here is a thin wrapper around
// an already-stateless HTTP service, so there's no session state worth
// the bookkeeping cost of a persistent per-client session.
@ApiExcludeController()
@Controller('mcp')
export class McpController {
  constructor(private readonly mcpServerFactory: McpServerFactory) {}

  @Post()
  async handlePost(@Req() req: Request, @Res() res: Response): Promise<void> {
    const server = this.mcpServerFactory.create();
    try {
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
      res.on('close', () => {
        void transport.close();
        void server.close();
      });
    } catch {
      if (!res.headersSent) {
        res.status(500).json(JSON_RPC_INTERNAL_ERROR);
      }
    }
  }

  // No session exists in stateless mode, so GET (SSE stream for a
  // stateful session) and DELETE (closing one) are simply unsupported.
  @Get()
  rejectGet(@Res() res: Response): void {
    res.status(405).json(JSON_RPC_METHOD_NOT_ALLOWED);
  }

  @Delete()
  rejectDelete(@Res() res: Response): void {
    res.status(405).json(JSON_RPC_METHOD_NOT_ALLOWED);
  }
}
