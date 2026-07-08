using System;
using System.Speech.Recognition;
using System.Diagnostics;
using System.IO;
using System.Reflection;

[assembly: AssemblyTitle("myraluncher")]
[assembly: AssemblyDescription("Myra voice wake word detector")]
[assembly: AssemblyCompany("Myra")]
[assembly: AssemblyProduct("myraluncher")]

class Program {
    static void Main(string[] args) {
        try {
            using (SpeechRecognitionEngine recognizer = new SpeechRecognitionEngine()) {
                Choices choices = new Choices();
                choices.Add(new string[] { "hey myra", "hello myra", "wake up myra", "hey syra", "hello syra", "wake up syra", "launch myra", "launch check" });

                GrammarBuilder gb = new GrammarBuilder();
                gb.Append(choices);

                Grammar g = new Grammar(gb);
                recognizer.LoadGrammar(g);

                recognizer.SpeechRecognized += (s, e) => {
                    string appPath = Process.GetCurrentProcess().MainModule.FileName;
                    string dir = Path.GetDirectoryName(appPath);
                    string[] possibleExeNames = { "myra.exe", "syra.exe" };
                    bool found = false;
                    foreach (string exeName in possibleExeNames) {
                        string target = Path.Combine(dir, exeName);
                        if (File.Exists(target)) {
                            Process.Start(target);
                            found = true;
                            break;
                        }
                    }
                    if (!found) {
                        DirectoryInfo parentInfo = Directory.GetParent(dir);
                        string parent = parentInfo != null ? parentInfo.FullName : null;
                        if (parent != null) {
                            foreach (string exeName in possibleExeNames) {
                                string target = Path.Combine(parent, exeName);
                                if (File.Exists(target)) {
                                    Process.Start(target);
                                    found = true;
                                    break;
                                }
                            }
                        }
                    }
                };

                recognizer.SetInputToDefaultAudioDevice();
                recognizer.RecognizeAsync(RecognizeMode.Multiple);

                System.Threading.Thread.Sleep(System.Threading.Timeout.Infinite);
            }
        } catch (Exception) {
            // Silently fail in background
        }
    }
}
