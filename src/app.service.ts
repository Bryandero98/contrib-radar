import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getHello(): string {
    return 'contrib-radar is running - see /docs for the API, /dashboard for the UI.';
  }
}
