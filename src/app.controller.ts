import { Controller, Get, Redirect } from '@nestjs/common';

// / is where a link to the project actually gets clicked, so it sends
// people straight to the one part of contrib-radar meant to be opened in
// a browser - a plain-text status line here would just be a dead end.
@Controller()
export class AppController {
  @Get()
  @Redirect('/dashboard')
  root(): void {}
}
