import { Text } from "@mantine/core";
import { splitFileName } from "../../utils/file.util";

/**
 * Shows a file's folder path dimmed and its name in the normal body weight.
 * Folder uploads can contain equal base names, so dropping the path would make
 * rows ambiguous.
 */
const FileName = ({ name }: { name: string }) => {
  const { folderPath, baseName } = splitFileName(name);

  return (
    <Text size="sm" truncate title={name}>
      {folderPath && (
        <Text component="span" color="dimmed">
          {folderPath}/
        </Text>
      )}
      <Text component="span">{baseName}</Text>
    </Text>
  );
};

export default FileName;
