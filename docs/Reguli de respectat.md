# Reguli de respectat

1. Fara comentarii in fisierele cu cod.
2. Orice update facut in cod trebuie sa fie reflectat conform si in fisierele de documentatie.
3. Implementarile in cod vor fi gandite astfel incat botul sa fie cat mai bun in ce face si cat mai optimizat; nu conteaza greutatea implementarii, ci ca propunerea in cod sa faca botul cat mai performant posibil. Acelasi lucru este valabil si cand se da review la cod, nu doar cand se face implementarea de cod.
4. Pentru fiecare functionalitate nou introdusa pentru botul de Discord, trebuie adaugate teste care sa testeze functionalitatea nou adaugata.
5. Nu se scoate o bucata de limbaj de cod, de exemplu Rust, decat daca noul limbaj cu care este inlocuita acea bucata de cod face botul mai bun in ce face si mai eficient.
6. Testele repo-ului trebuie rulate intr-un mediu care are pachetele si tool-urile necesare pentru validare; de exemplu, pentru testele Rust s-a instalat Cargo.
7. Orice noua implementare de cod in repo trebuie facuta in GitHub pe branch nou si PR, ca implementarea sa fie verificata ca merge.
8. Cand se face un nou PR, AI-ul trebuie sa verifice daca acest PR va avea conflicte cu situatia curenta din repo.
9. Fiecare fisier nou trebuie sa primeasca un nume corespunzator functionalitatii sau rolului pe care il are in repo, nu un nume random, de exemplu `notification/codex`. Numele fisierului trebuie sa descrie doar functionalitatea corespunzatoare si nu trebuie sa includa cine a facut acel fisier.
10. Daca se da review la acest repo, review-ul trebuie sa fie onest si sa dea nota pentru fiecare categorie relevanta a botului de Discord. Nota nu trebuie sa fie incurajatoare, ci trebuie sa reflecte nivelul real la care este botul acum. Pentru fiecare categorie notata, trebuie justificat de ce s-a dat nota respectiva si cum s-ar putea imbunatati codul pentru acea categorie.
11. Daca la un review de cod sunt mai multe lucruri de implementat in repo si nu se pot face toate dintr-o data, AI-ul trebuie sa retina sau sa isi scrie undeva toate lucrurile care sunt de implementat.
12. Un AI care trebuie sa dea doar review la cod trebuie sa respecte doar regulile din acest fisier care tin de review-ul de cod, nu si regulile care nu au legatura cu review-ul de cod.
13. Cand se da review la cod, AI-ul trebuie sa mentioneze mai multe fix-uri sau imbunatatiri pentru codul din repo, nu doar un singur fix sau o singura imbunatatire, decat daca a ramas un singur fix sau o singura imbunatatire pentru nota 10.
14. Daca o regula noua care urmeaza sa fie adaugata in acest fisier are aceleasi cerinte ca o regula deja existenta mai sus, regula noua nu se mai adauga in fisier.
15. Cand se adauga o regula noua in acest fisier, se da direct merge, pentru ca nu este nevoie sa se verifice ceva cand este adaugata o regula.
16. Toate implementarile in cod trebuie sa respecte toate regulile din acest fisier.
17. Regulile care au legatura cu toate celelalte reguli trebuie puse ultimele in lista de reguli si trebuie facuta renumerotarea.
