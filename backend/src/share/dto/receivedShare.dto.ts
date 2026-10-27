import { Expose, plainToClass, Type } from "class-transformer";

class ReceivedShareCreatorDTO {
  @Expose()
  id: string;

  @Expose()
  username: string;

  @Expose()
  displayName?: string;

  @Expose()
  avatarUpdatedAt?: Date | null;
}

class ReceivedShareDetailsDTO {
  @Expose()
  id: string;

  @Expose()
  name: string;

  @Expose()
  expiration: Date;

  @Expose()
  @Type(() => ReceivedShareCreatorDTO)
  creator: ReceivedShareCreatorDTO;
}

export class ReceivedShareDTO {
  @Expose()
  id: string;

  @Expose()
  @Type(() => ReceivedShareDetailsDTO)
  share: ReceivedShareDetailsDTO;

  fromList(partial: Partial<ReceivedShareDTO>[]) {
    return partial.map((part) =>
      plainToClass(ReceivedShareDTO, part, { excludeExtraneousValues: true }),
    );
  }
}
