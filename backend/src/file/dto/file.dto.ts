import { Expose, plainToClass } from "class-transformer";
import { ShareDTO } from "src/share/dto/share.dto";

export class FileDTO {
  @Expose()
  id: string;

  @Expose()
  name: string;

  @Expose()
  size: string;

  // Per-file VirusTotal verdict (from the share's virustotal.json). `clean`
  // and `suspicious` scans are kept; malicious files are removed instead.
  @Expose()
  virustotal?: {
    verdict: "clean" | "suspicious";
    malicious?: number;
    suspicious?: number;
    harmless?: number;
    undetected?: number;
    engines?: number;
    hash?: string;
    scannedAt: string;
  };

  share: ShareDTO;

  from(partial: Partial<FileDTO>) {
    return plainToClass(FileDTO, partial, { excludeExtraneousValues: true });
  }
}
