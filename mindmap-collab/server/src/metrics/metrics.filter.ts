import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Injectable,
} from '@nestjs/common';
import { MetricsService } from './metrics.service';

/** 全局异常过滤器：统计 5xx 错误率指标 */
@Catch()
@Injectable()
export class MetricsFilter implements ExceptionFilter {
  constructor(private metrics: MetricsService) {}

  catch(exception: any, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    const status =
      exception instanceof HttpException ? exception.getStatus() : 500;
    if (status >= 500) this.metrics.recordError();

    const body =
      exception instanceof HttpException
        ? exception.getResponse()
        : { statusCode: 500, message: 'Internal server error' };
    response.status(status).json(body);
  }
}
