import AuthPage from '@/AuthPage';
export default function Register() {
  return (
    <div>
      <AuthPage action="register" />
    </div>
  );
}

export { getServerSideProps } from '@/emptyGetServerSideProps';
