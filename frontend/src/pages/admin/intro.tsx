import { Button, Center, Container, Stack, Text, Title } from "@mantine/core";
import Link from "next/link";
import Logo from "../../components/Logo";
import Meta from "../../components/Meta";
import useHomeHref from "../../hooks/homeHref.hook";

const Intro = () => {
  const homeRef = useHomeHref();

  return (
    <>
      <Meta title="Intro" />
      <Container size="xs">
        <Stack>
          <Center>
            <Logo height={80} width={80} />
          </Center>
          <Center>
            <Title order={1} size="h2">
              Welcome to your file-sharing platform
            </Title>
          </Center>
          <Text>
            This administration area lets you configure sharing, security,
            storage and email for this site.
          </Text>
          <Text>You're all set. Choose how you want to continue.</Text>
          <Stack mt="lg">
            <Button href="/admin/config/general" component={Link}>
              Customize configuration
            </Button>
            <Button href={homeRef} component={Link} variant="light">
              Explore the site
            </Button>
          </Stack>
        </Stack>
      </Container>
    </>
  );
};

export default Intro;
