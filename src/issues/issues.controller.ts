import { Controller, Get, Param, Query } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { IssuesService, type IssueSort } from './issues.service';

@ApiTags('issues')
@Controller('repos')
export class IssuesController {
  constructor(private readonly issuesService: IssuesService) {}

  @Get(':id/issues')
  @ApiOperation({
    summary:
      'List scored issues for a watched repo, highest-opportunity first by default',
  })
  @ApiQuery({ name: 'sort', required: false, enum: ['score', 'updated'] })
  @ApiOkResponse()
  listScoredIssues(@Param('id') id: string, @Query('sort') sort?: IssueSort) {
    return this.issuesService.listScoredIssues(id, sort);
  }
}
