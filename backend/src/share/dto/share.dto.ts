import { Expose, plainToClass, Type } from "class-transformer";
import { FileDTO } from "src/file/dto/file.dto";
import type { UploaderInfo } from "src/utils/uploaderInfo.util";
import { PublicUserDTO } from "src/user/dto/publicUser.dto";

export class ShareDTO {
  @Expose()
  id: string;

  @Expose()
  name?: string;

  @Expose()
  createdAt: Date;

  @Expose()
  expiration: Date;

  @Expose()
  views: number;

  @Expose()
  maxViews?: number;

  @Expose()
  maxDownloads?: number;

  @Expose()
  downloadCount?: number;

  @Expose()
  @Type(() => FileDTO)
  files: FileDTO[];

  @Expose()
  @Type(() => PublicUserDTO)
  creator: PublicUserDTO;

  @Expose()
  description: string;

  @Expose()
  hasPassword: boolean;

  @Expose()
  isZipReady: boolean;

  @Expose()
  size: number;

  @Expose()
  uploaderInfo?: UploaderInfo;

  @Expose()
  downloads?: { total: number; files: Record<string, number> };

  @Expose()
  commentsVersion?: number;

  from(partial: Partial<ShareDTO>) {
    return plainToClass(ShareDTO, partial, { excludeExtraneousValues: true });
  }

  fromList(partial: Partial<ShareDTO>[]) {
    return partial.map((part) =>
      plainToClass(ShareDTO, part, { excludeExtraneousValues: true }),
    );
  }
}
