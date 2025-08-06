import { HdxTask, TaskArgs } from '@/tasks/types';
import logger from '@/utils/logger';

export default class PingPongTask implements HdxTask {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async execute(args: TaskArgs): Promise<void> {
    logger.info(`
                   O .
                 _/|\\_-O
                ___|_______
               /     |     \
              /      |      \
             #################
            /   _ ( )|        \
           /    ( ) ||         \
          /  \\  |_/ |          \
         /____\\/|___|___________\
            |    |             |
            |   / \\           |
            |  /   \\          |
            |_/    /_
        `);
  }

  async asyncDispose(): Promise<void> {}
}
