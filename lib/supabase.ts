import { createClient } from '@supabase/supabase-js';

// Credentials provided by the user
const supabaseUrl = 'https://ufnfklvbivzlicpzmwhp.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVmbmZrbHZiaXZ6bGljcHptd2hwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzEzMjE3OTUsImV4cCI6MjA4Njg5Nzc5NX0._XD4d3glHLLHwZOovcRIrl7aw2Zuwhsj4OeQNQTpgeE';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);