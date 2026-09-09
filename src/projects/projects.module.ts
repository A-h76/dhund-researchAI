import { Module } from '@nestjs/common';
import { IamModule } from '../iam/iam.module';
import { PlatformModule } from '../platform/platform.module';
import { TenancyAuthorizer } from './authorization/tenancy-authorizer';
import { MembershipsController } from './memberships.controller';
import { OrgsController } from './orgs.controller';
import { ProjectsController } from './projects.controller';
import { TenancyService } from './tenancy.service';

@Module({
  imports: [PlatformModule, IamModule],
  controllers: [OrgsController, ProjectsController, MembershipsController],
  providers: [TenancyAuthorizer, TenancyService],
  exports: [IamModule],
})
export class ProjectsModule {}
