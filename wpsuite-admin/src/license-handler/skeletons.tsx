import { Group, Skeleton, Stack } from "@mantine/core";

export function FullSkeleton() {
  return (
    <Group gap="xs">
      <Skeleton height={24} circle />
      <EmailSkeleton />
      <Skeleton height={48} width={300} />
    </Group>
  );
}

export function EmailSkeleton() {
  return (
    <Stack gap="8px">
      <Skeleton height={8} width={100} radius="xl" />
      <Skeleton height={8} width={100} radius="xl" />
    </Stack>
  );
}
